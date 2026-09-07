const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { sendLeaveStatusNotification } = require('../services/push-notifications');

// GET /api/leave/student/:studentId — Get leave history
router.get('/student/:studentId', auth, async (req, res) => {
  try {
    const { studentId } = req.params;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(
      `SELECT la.*, u.name as applied_by_name,
       COALESCE(t.name, '') as approved_by_name
       FROM leave_applications la
       JOIN users u ON u.id = la.applied_by
       LEFT JOIN users t ON t.id = la.approved_by
       WHERE la.student_id = $1
       ORDER BY la.created_at DESC
       LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) FROM leave_applications WHERE student_id = $1',
      [studentId]
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get leave history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leave — Apply for leave (parent)
router.post('/', auth, async (req, res) => {
  const { student_id, reason, start_date, end_date } = req.body;

  if (!student_id || !reason || !start_date || !end_date) {
    return res.status(400).json({ error: 'student_id, reason, start_date, and end_date are required' });
  }

  if (new Date(start_date) > new Date(end_date)) {
    return res.status(400).json({ error: 'start_date cannot be after end_date' });
  }

  // Validation: start_date must be today or future
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(start_date) < today) {
    return res.status(400).json({ error: 'start_date must be today or a future date' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO leave_applications (school_id, student_id, applied_by, reason, start_date, end_date)
       VALUES (
         (SELECT school_id FROM students WHERE id = $1),
         $1, $2, $3, $4, $5
       ) RETURNING *`,
      [student_id, req.user.id, reason, start_date, end_date]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Apply leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leave/pending/:teacherId — Get pending approvals (teacher)
router.get('/pending/:teacherId', auth, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Get classes assigned to this teacher
    const classResult = await db.query(
      'SELECT class FROM teacher_classes WHERE teacher_id = $1',
      [teacherId]
    );
    const classes = classResult.rows.map(r => r.class);

    if (!classes.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    }

    const { rows } = await db.query(
      `SELECT la.*, u.name as student_name, s.class, s.section, s.roll_no
       FROM leave_applications la
       JOIN students s ON s.id = la.student_id
       JOIN users u ON u.id = la.student_id
       WHERE la.status = 'pending' AND s.class = ANY($1)
       ORDER BY la.created_at DESC
       LIMIT $2 OFFSET $3`,
      [classes, limit, offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM leave_applications la
       JOIN students s ON s.id = la.student_id
       WHERE la.status = 'pending' AND s.class = ANY($1)`,
      [classes]
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get pending leaves error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/leave/:id — Approve/reject leave (teacher)
 * On approval, auto-inserts attendance records with status='leave' for working days.
 * Validates that the approving teacher is assigned to the student's class.
 */
router.put('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { status, remarks } = req.body;

  if (!status || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "approved" or "rejected"' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Fetch the leave application
    const leaveResult = await client.query(
      'SELECT * FROM leave_applications WHERE id = $1',
      [id]
    );
    if (!leaveResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Leave application not found' });
    }
    const leave = leaveResult.rows[0];

    // Prevent re-processing already resolved applications
    if (leave.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Leave application already ${leave.status}` });
    }

    // Validate: only teacher assigned to student's class can approve
    const studentResult = await client.query(
      'SELECT class FROM students WHERE id = $1',
      [leave.student_id]
    );
    if (studentResult.rows.length) {
      const studentClass = studentResult.rows[0].class;
      const teacherClassCheck = await client.query(
        'SELECT id FROM teacher_classes WHERE teacher_id = $1 AND class = $2',
        [req.user.id, studentClass]
      );
      if (!teacherClassCheck.rows.length) {
        // Also check teacher_subject_classes as a fallback
        const tscCheck = await client.query(
          'SELECT id FROM teacher_subject_classes WHERE teacher_id = $1 AND class = $2 LIMIT 1',
          [req.user.id, studentClass]
        );
        if (!tscCheck.rows.length) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'You are not assigned to this student\'s class' });
        }
      }
    }

    // Update leave status
    const { rows } = await client.query(
      `UPDATE leave_applications
       SET status = $1, approved_by = $2, remarks = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, req.user.id, remarks || null, id]
    );

    // If approved, auto-insert attendance records with status='leave' for working days
    if (status === 'approved') {
      const startDate = new Date(leave.start_date);
      const endDate = new Date(leave.end_date);

      // Get holidays for this date range to skip them (graceful if table doesn't exist)
      let holidayDates = new Set();
      try {
        const holidays = await client.query(
          `SELECT date FROM school_calendar
           WHERE school_id = $1 AND type IN ('holiday') AND date BETWEEN $2 AND $3`,
          [leave.school_id, leave.start_date, leave.end_date]
        );
        holidayDates = new Set(holidays.rows.map(r => r.date.toISOString().split('T')[0]));
      } catch (calErr) {
        // school_calendar table may not exist yet — proceed without holiday check
        if (calErr.code !== '42P01') throw calErr;
      }

      // Iterate through each day and insert attendance for working days
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayOfWeek = currentDate.getDay(); // 0=Sunday, 6=Saturday

        // Skip weekends (Sunday=0, Saturday=6) and holidays
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(dateStr)) {
          await client.query(
            `INSERT INTO attendance (school_id, student_id, teacher_id, class, date, status, period)
             VALUES ($1, $2, $3, $4, $5, 'leave', NULL)
             ON CONFLICT (student_id, date) DO UPDATE SET status = 'leave'`,
            [leave.school_id, leave.student_id, req.user.id, studentResult.rows[0]?.class || '', dateStr]
          );
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    await client.query('COMMIT');

    // Send push notification to parent about leave status (non-blocking)
    try {
      const parentTokens = await db.query(
        `SELECT dt.fcm_token FROM device_tokens dt
         WHERE dt.user_id = $1 AND dt.is_active = true`,
        [leave.applied_by]
      );
      if (parentTokens.rows.length) {
        const studentNameResult = await db.query(
          'SELECT name FROM users WHERE id = $1',
          [leave.student_id]
        );
        const studentName = studentNameResult.rows[0]?.name || 'Student';
        const tokens = parentTokens.rows.map(r => r.fcm_token);
        await sendLeaveStatusNotification(tokens, status, studentName);
      }
    } catch (pushErr) {
      console.error('[Push] Leave status notification error:', pushErr.message);
    }

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update leave error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
