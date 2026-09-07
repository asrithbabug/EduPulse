const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { sendHomeworkNotification } = require('../services/push-notifications');

// GET /api/homework/:classId — Get homework for a class
router.get('/:classId', auth, async (req, res) => {
  try {
    const { classId } = req.params;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(
      `SELECT h.*, u.name as assigned_by_name
       FROM homework h
       JOIN users u ON u.id = h.assigned_by
       WHERE h.class = $1
       ORDER BY h.created_at DESC
       LIMIT $2 OFFSET $3`,
      [classId, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) FROM homework WHERE class = $1',
      [classId]
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get homework error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/homework/student/:studentId — Get homework for a student
router.get('/student/:studentId', auth, async (req, res) => {
  try {
    const { studentId } = req.params;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Get student's class first
    const studentResult = await db.query(
      'SELECT class, section FROM students WHERE id = $1',
      [studentId]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const { class: cls, section } = studentResult.rows[0];

    const { rows } = await db.query(
      `SELECT h.*, u.name as assigned_by_name,
       COALESCE(hs.status, 'pending') as submission_status,
       hs.submitted_at, hs.remarks, hs.grade
       FROM homework h
       JOIN users u ON u.id = h.assigned_by
       LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = $1
       WHERE h.class = $2 AND (h.section IS NULL OR h.section = $3)
       ORDER BY h.due_date DESC
       LIMIT $4 OFFSET $5`,
      [studentId, cls, section, limit, offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM homework WHERE class = $1 AND (section IS NULL OR section = $2)`,
      [cls, section]
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

// POST /api/homework — Post new homework (teacher)
router.post('/', auth, async (req, res) => {
  const { class: cls, section, subject, title, description, due_date, attachment_url } = req.body;

  if (!cls || !subject || !title) {
    return res.status(400).json({ error: 'Class, subject, and title are required' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO homework (school_id, class, section, subject, title, description, due_date, assigned_by, attachment_url)
       VALUES (
         (SELECT school_id FROM users WHERE id = $1),
         $2, $3, $4, $5, $6, $7, $1, $8
       ) RETURNING *`,
      [req.user.id, cls, section || null, subject, title, description || null, due_date || null, attachment_url || null]
    );

    // Create pending submissions for all students in the class
    await db.query(
      `INSERT INTO homework_submissions (homework_id, student_id, status)
       SELECT $1, s.id, 'pending'
       FROM students s
       WHERE s.class = $2 AND ($3::VARCHAR IS NULL OR s.section = $3)
       ON CONFLICT DO NOTHING`,
      [rows[0].id, cls, section || null]
    );

    // Send push notification to parents in this class (non-blocking)
    try {
      const schoolId = rows[0].school_id;
      await sendHomeworkNotification(schoolId, cls, subject, title);
    } catch (pushErr) {
      console.error('[Push] Homework notification error:', pushErr.message);
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create homework error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/homework/:id/status — Mark homework complete (student)
router.put('/:id/status', auth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !['completed', 'late'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "completed" or "late"' });
  }

  try {
    // Determine the student_id — if parent role, use their user id (which maps to student)
    const studentId = req.user.id;

    const { rows } = await db.query(
      `INSERT INTO homework_submissions (homework_id, student_id, status, submitted_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (homework_id, student_id)
       DO UPDATE SET status = $3, submitted_at = NOW()
       RETURNING *`,
      [id, studentId, status]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Homework not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Update homework status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
