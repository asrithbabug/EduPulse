const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/timetable/:classId — Get timetable for a class
router.get('/:classId', auth, async (req, res) => {
  try {
    const { classId } = req.params;
    const section = req.query.section || null;

    let query = `
      SELECT t.*, u.name as teacher_name
      FROM timetable t
      LEFT JOIN users u ON u.id = t.teacher_id
      WHERE t.class = $1`;
    const params = [classId];

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

    res.json({ class: classId, section, timetable: grouped });
  } catch (err) {
    console.error('Get timetable error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/timetable/teacher/:teacherId — Get teacher's timetable
router.get('/teacher/:teacherId', auth, async (req, res) => {
  try {
    const { teacherId } = req.params;

    const { rows } = await db.query(
      `SELECT t.*, u.name as teacher_name
       FROM timetable t
       LEFT JOIN users u ON u.id = t.teacher_id
       WHERE t.teacher_id = $1
       ORDER BY t.day_of_week, t.period`,
      [teacherId]
    );

    // Group by day
    const grouped = {};
    for (const row of rows) {
      const day = row.day_of_week;
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(row);
    }

    res.json({ teacher_id: teacherId, timetable: grouped });
  } catch (err) {
    console.error('Get teacher timetable error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/timetable — Create/update timetable entry (admin)
router.post('/', auth, async (req, res) => {
  const { class: cls, section, day_of_week, period, start_time, end_time, subject, teacher_id, room } = req.body;

  if (!cls || !day_of_week || !period || !start_time || !end_time || !subject) {
    return res.status(400).json({ error: 'Class, day_of_week, period, start_time, end_time, and subject are required' });
  }

  if (day_of_week < 1 || day_of_week > 7) {
    return res.status(400).json({ error: 'day_of_week must be between 1 and 7' });
  }

  try {
    // Validation: check if teacher is already assigned at the same day+period in another class
    if (teacher_id) {
      const conflictCheck = await db.query(
        `SELECT class, subject FROM timetable
         WHERE teacher_id = $1 AND day_of_week = $2 AND period = $3 AND class != $4
         AND school_id = (SELECT school_id FROM users WHERE id = $5)`,
        [teacher_id, day_of_week, period, cls, req.user.id]
      );
      if (conflictCheck.rows.length) {
        const conflict = conflictCheck.rows[0];
        return res.status(409).json({
          error: `Teacher is already assigned to class ${conflict.class} at this time (${conflict.subject})`
        });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO timetable (school_id, class, section, day_of_week, period, start_time, end_time, subject, teacher_id, room)
       VALUES (
         (SELECT school_id FROM users WHERE id = $1),
         $2, $3, $4, $5, $6, $7, $8, $9, $10
       )
       ON CONFLICT (school_id, class, section, day_of_week, period)
       DO UPDATE SET start_time = $6, end_time = $7, subject = $8, teacher_id = $9, room = $10
       RETURNING *`,
      [req.user.id, cls, section || null, day_of_week, period, start_time, end_time, subject, teacher_id || null, room || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create timetable error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
