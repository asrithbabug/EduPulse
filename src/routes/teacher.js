const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { sendAbsenceAlert } = require('../services/notifications');
const { sendAbsenceNotification } = require('../services/push-notifications');

// GET /api/teacher/classes/:class/students
router.get('/classes/:class/students', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, s.roll_no FROM users u
       JOIN students s ON s.id = u.id
       WHERE s.class = $1 AND s.school_id = $2 ORDER BY s.roll_no`,
      [req.params.class, req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/teacher/attendance — mark attendance
router.post('/attendance', auth, async (req, res) => {
  const { class: cls, date, attendance, period } = req.body;
  // attendance = [{ studentId, status }]
  if (!cls || !date || !attendance?.length)
    return res.status(400).json({ error: 'Missing fields' });

  try {
    // Validate: check school_calendar — reject if today is a holiday
    // Gracefully handle case where school_calendar table doesn't exist (migration not run)
    try {
      const holidayCheck = await db.query(
        `SELECT id, title FROM school_calendar
         WHERE school_id = $1 AND date = $2 AND type = 'holiday'`,
        [req.user.school_id, date]
      );
      if (holidayCheck.rows.length) {
        return res.status(400).json({
          error: `Cannot mark attendance: ${date} is a holiday (${holidayCheck.rows[0].title})`
        });
      }
    } catch (calErr) {
      // school_calendar table may not exist yet — skip holiday check
      if (calErr.code !== '42P01') throw calErr; // 42P01 = undefined_table
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const a of attendance) {
        await client.query(
          `INSERT INTO attendance (school_id, student_id, teacher_id, class, date, status, period)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (student_id, date) DO UPDATE SET status = $6, teacher_id = $3, period = $7`,
          [req.user.school_id, a.studentId, req.user.id, cls, date, a.status, period || null]
        );
        // Send SMS alert for absent students
        if (a.status === 'absent') {
          const { rows } = await client.query(
            `SELECT u.name, u.phone FROM users u
             JOIN students s ON s.id = u.id WHERE u.id = $1`,
            [a.studentId]
          );
          if (rows[0]?.phone) {
            await sendAbsenceAlert(rows[0].phone, rows[0].name, date).catch(console.error);
          }
          // Send push notification to parent's devices
          try {
            const parentId = rows[0]?.parent_id || a.studentId; // fallback to student
            const deviceTokens = await client.query(
              `SELECT dt.fcm_token FROM device_tokens dt
               JOIN students s ON s.parent_id = dt.user_id
               WHERE s.id = $1 AND dt.is_active = true`,
              [a.studentId]
            );
            if (deviceTokens.rows.length) {
              const tokens = deviceTokens.rows.map(r => r.fcm_token);
              await sendAbsenceNotification(tokens, rows[0]?.name || 'Student', date);
            }
          } catch (pushErr) {
            // Never let push notification failure break attendance marking
            console.error('[Push] Absence notification error:', pushErr.message);
          }
        }
      }
      await client.query('COMMIT');
      res.json({ success: true, message: `Attendance saved for Class ${cls}${period ? ` (Period ${period})` : ''}` });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.status) return; // already responded
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/teacher/materials
router.post('/materials', auth, async (req, res) => {
  const { title, subject, class: cls, type } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO materials (school_id, title, subject, class, type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.school_id, title, subject, cls, type, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/teacher/materials/:class
router.get('/materials/:class', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.*, u.name as uploaded_by_name FROM materials m
       JOIN users u ON u.id = m.uploaded_by
       WHERE m.class = $1 AND m.school_id = $2 ORDER BY m.created_at DESC`,
      [req.params.class, req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// TEACHER SELF ATTENDANCE
// ══════════════════════════════════════════════════════════════════

// POST /api/teacher/self-attendance — Teacher marks their own attendance
router.post('/self-attendance', auth, async (req, res) => {
  const { status, date, remarks } = req.body;
  const validStatuses = ['present', 'absent', 'leave', 'half_day'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    const { rows } = await db.query(
      `INSERT INTO teacher_attendance (teacher_id, date, status, remarks, marked_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (teacher_id, date)
       DO UPDATE SET status = $3, remarks = $4, marked_at = NOW()
       RETURNING *`,
      [req.user.id, targetDate, status, remarks || null]
    );
    res.json({ success: true, attendance: rows[0] });
  } catch (err) {
    console.error('Teacher self-attendance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/teacher/self-attendance — Get own attendance history
router.get('/self-attendance', auth, async (req, res) => {
  try {
    const { month, year } = req.query;
    let query = `SELECT * FROM teacher_attendance WHERE teacher_id = $1`;
    const params = [req.user.id];
    let idx = 2;

    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM date) = $${idx} AND EXTRACT(YEAR FROM date) = $${idx + 1}`;
      params.push(month, year);
    }

    query += ' ORDER BY date DESC LIMIT 60';
    const { rows } = await db.query(query, params);

    const total = rows.length;
    const present = rows.filter(r => r.status === 'present').length;
    const leave = rows.filter(r => r.status === 'leave').length;
    const absent = rows.filter(r => r.status === 'absent').length;
    const halfDay = rows.filter(r => r.status === 'half_day').length;

    res.json({
      summary: { total, present, leave, absent, half_day: halfDay },
      records: rows,
    });
  } catch (err) {
    console.error('Get teacher attendance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/teacher/self-attendance/today — Check if already marked today
router.get('/self-attendance/today', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { rows } = await db.query(
      'SELECT * FROM teacher_attendance WHERE teacher_id = $1 AND date = $2',
      [req.user.id, today]
    );
    res.json({ marked: rows.length > 0, record: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
