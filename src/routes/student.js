const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/student/:id/attendance
router.get('/:id/attendance', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await db.query(
      `SELECT date, status FROM attendance WHERE student_id=$1 ORDER BY date DESC LIMIT 30`,
      [id]
    );
    const total   = rows.rows.length;
    const present = rows.rows.filter(r => r.status === 'present').length;
    const absent  = total - present;
    res.json({
      total, present, absent,
      percentage: total ? Math.round((present / total) * 100 * 10) / 10 : 0,
      recent: rows.rows.slice(0, 10),
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/student/:id/marks
router.get('/:id/marks', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT subject, exam_type, marks, total_marks, grade
       FROM marks WHERE student_id=$1 ORDER BY subject`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/student/:id/fees
router.get('/:id/fees', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM fees WHERE student_id=$1 ORDER BY due_date`,
      [req.params.id]
    );
    const annual = rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    const paid   = rows.filter(r => r.status === 'paid').reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    res.json({ annual, paid, due: annual - paid, history: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// ADDITIONAL STUDENT ENDPOINTS
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/student/:id/timetable — Student's class timetable
 */
router.get('/:id/timetable', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get student's class
    const studentResult = await db.query(
      'SELECT class, section FROM students WHERE id = $1',
      [id]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const { class: cls, section } = studentResult.rows[0];

    let query = `
      SELECT t.*, u.name as teacher_name
      FROM timetable t
      LEFT JOIN users u ON u.id = t.teacher_id
      WHERE t.class = $1`;
    const params = [cls];

    if (section) {
      query += ' AND (t.section IS NULL OR t.section = $2)';
      params.push(section);
    }

    query += ' ORDER BY t.day_of_week, t.period';

    const { rows } = await db.query(query, params);

    // Group by day
    const grouped = {};
    for (const row of rows) {
      const day = row.day_of_week;
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(row);
    }

    res.json({ student_id: id, class: cls, section, timetable: grouped });
  } catch (err) {
    console.error('Get student timetable error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/student/:id/homework — Student's homework
 */
router.get('/:id/homework', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get student's class
    const studentResult = await db.query(
      'SELECT class, school_id FROM students WHERE id = $1',
      [id]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const { class: cls, school_id } = studentResult.rows[0];
    const page   = parseInt(req.query.page) || 1;
    const limit  = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(
      `SELECT h.*, u.name as teacher_name
       FROM homework h
       LEFT JOIN users u ON u.id = h.assigned_by
       WHERE h.class = $1 AND h.school_id = $2
       ORDER BY h.created_at DESC
       LIMIT $3 OFFSET $4`,
      [cls, school_id, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) FROM homework WHERE class = $1 AND school_id = $2',
      [cls, school_id]
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get student homework error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/student/:id/teachers — Teachers assigned to student's class (for chat discovery)
 */
router.get('/:id/teachers', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get student's class
    const studentResult = await db.query(
      'SELECT class FROM students WHERE id = $1',
      [id]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const cls = studentResult.rows[0].class;

    // Get teachers from teacher_classes and teacher_subject_classes
    const { rows } = await db.query(
      `SELECT DISTINCT u.id, u.name, u.phone,
              COALESCE(s.name, tc.subject) as subject
       FROM teacher_classes tc
       JOIN users u ON u.id = tc.teacher_id
       LEFT JOIN teacher_subject_classes tsc ON tsc.teacher_id = tc.teacher_id AND tsc.class = tc.class
       LEFT JOIN subjects s ON s.id = tsc.subject_id
       WHERE tc.class = $1
       UNION
       SELECT DISTINCT u.id, u.name, u.phone, s.name as subject
       FROM teacher_subject_classes tsc
       JOIN users u ON u.id = tsc.teacher_id
       JOIN subjects s ON s.id = tsc.subject_id
       WHERE tsc.class = $1
       ORDER BY name`,
      [cls]
    );

    res.json(rows);
  } catch (err) {
    console.error('Get student teachers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/student/:id/calendar — School calendar events for the student
 */
router.get('/:id/calendar', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year } = req.query;

    // Get student's school_id
    const studentResult = await db.query(
      'SELECT school_id FROM students WHERE id = $1',
      [id]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const schoolId = studentResult.rows[0].school_id;

    let query = `SELECT * FROM school_calendar WHERE school_id = $1`;
    const params = [schoolId];
    let idx = 2;

    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM date) = $${idx} AND EXTRACT(YEAR FROM date) = $${idx + 1}`;
      params.push(parseInt(month), parseInt(year));
      idx += 2;
    } else if (year) {
      query += ` AND EXTRACT(YEAR FROM date) = $${idx}`;
      params.push(parseInt(year));
      idx++;
    } else {
      // Default: next 90 days
      query += ` AND date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'`;
    }

    query += ' ORDER BY date';
    const { rows } = await db.query(query, params);

    res.json(rows);
  } catch (err) {
    console.error('Get student calendar error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/student/:id/achievements — Student achievements/awards
 */
router.get('/:id/achievements', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if achievements table exists, if not return empty
    try {
      const { rows } = await db.query(
        `SELECT * FROM achievements WHERE student_id = $1 ORDER BY date DESC`,
        [id]
      );
      res.json(rows);
    } catch (tableErr) {
      // If table doesn't exist, return empty array gracefully
      if (tableErr.code === '42P01') {
        res.json([]);
      } else {
        throw tableErr;
      }
    }
  } catch (err) {
    console.error('Get student achievements error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
