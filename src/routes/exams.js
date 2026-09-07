const router    = require('express').Router();
const db        = require('../db');
const auth      = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// ══════════════════════════════════════════════════════════════════
// EXAM TYPES
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/exams/types — List exam types for the current academic year
 * Query params: ?year_id=X (optional, defaults to current year)
 */
router.get('/types', auth, async (req, res) => {
  try {
    const yearId = req.query.year_id;

    let query;
    let params;

    if (yearId) {
      query = `SELECT * FROM exam_types WHERE school_id = $1 AND academic_year_id = $2 ORDER BY created_at`;
      params = [req.user.school_id, yearId];
    } else {
      // Default: current academic year
      query = `SELECT et.* FROM exam_types et
               JOIN academic_years ay ON ay.id = et.academic_year_id
               WHERE et.school_id = $1 AND ay.is_current = true
               ORDER BY et.created_at`;
      params = [req.user.school_id];
    }

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('List exam types error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/exams/types — Create an exam type (admin only)
 */
router.post('/types', adminAuth, async (req, res) => {
  const { name, academic_year_id, max_marks, weightage } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Exam type name is required' });
  }

  try {
    // If no academic_year_id provided, use current year
    let yearId = academic_year_id;
    if (!yearId) {
      const yearResult = await db.query(
        'SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true',
        [req.user.school_id]
      );
      if (!yearResult.rows.length) {
        return res.status(400).json({ error: 'No current academic year set. Please create one first.' });
      }
      yearId = yearResult.rows[0].id;
    }

    const { rows } = await db.query(
      `INSERT INTO exam_types (school_id, name, academic_year_id, max_marks, weightage)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.school_id, name.trim(), yearId, max_marks || 100, weightage || 100]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Exam type with this name already exists for the academic year' });
    }
    console.error('Create exam type error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/exams/types/:id — Update an exam type (admin only)
 */
router.put('/types/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { name, max_marks, weightage, is_active } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Exam type name is required' });
  }

  try {
    const { rows } = await db.query(
      `UPDATE exam_types
       SET name = $1, max_marks = $2, weightage = $3, is_active = $4
       WHERE id = $5 AND school_id = $6
       RETURNING *`,
      [name.trim(), max_marks || 100, weightage || 100, is_active !== false, id, req.user.school_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Exam type not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Exam type with this name already exists for the academic year' });
    }
    console.error('Update exam type error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/exams/types/:id — Delete an exam type (admin only)
 */
router.delete('/types/:id', adminAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if there are scheduled exams for this type
    const schedCheck = await db.query(
      'SELECT COUNT(*) FROM exam_schedule WHERE exam_type_id = $1',
      [id]
    );
    if (parseInt(schedCheck.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot delete: exam schedule entries exist for this type. Deactivate instead.'
      });
    }

    const { rowCount } = await db.query(
      'DELETE FROM exam_types WHERE id = $1 AND school_id = $2',
      [id, req.user.school_id]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'Exam type not found' });
    }
    res.json({ message: 'Exam type deleted' });
  } catch (err) {
    console.error('Delete exam type error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// EXAM SCHEDULE
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/exams/schedule — Get exam schedule
 * Query params: ?class=10-A&exam_type_id=1&subject_id=2
 */
router.get('/schedule', auth, async (req, res) => {
  try {
    const { class: cls, exam_type_id, subject_id } = req.query;
    const page   = parseInt(req.query.page) || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let query = `
      SELECT es.*, et.name as exam_type_name, s.name as subject_name, s.code as subject_code
      FROM exam_schedule es
      JOIN exam_types et ON et.id = es.exam_type_id
      JOIN subjects s ON s.id = es.subject_id
      WHERE es.school_id = $1`;
    const params = [req.user.school_id];
    let idx = 2;

    if (cls) {
      query += ` AND es.class = $${idx}`;
      params.push(cls);
      idx++;
    }
    if (exam_type_id) {
      query += ` AND es.exam_type_id = $${idx}`;
      params.push(exam_type_id);
      idx++;
    }
    if (subject_id) {
      query += ` AND es.subject_id = $${idx}`;
      params.push(subject_id);
      idx++;
    }

    const countQuery = query.replace(
      /SELECT es\.\*, et\.name as exam_type_name, s\.name as subject_name, s\.code as subject_code/,
      'SELECT COUNT(*)'
    );
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY es.exam_date, es.start_time LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get exam schedule error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/exams/schedule — Create exam schedule entry (admin only)
 */
router.post('/schedule', adminAuth, async (req, res) => {
  const { exam_type_id, subject_id, class: cls, exam_date, start_time, end_time, room } = req.body;

  if (!exam_type_id || !subject_id || !cls) {
    return res.status(400).json({ error: 'exam_type_id, subject_id, and class are required' });
  }

  try {
    // Validate exam_type belongs to this school
    const typeCheck = await db.query(
      'SELECT id FROM exam_types WHERE id = $1 AND school_id = $2',
      [exam_type_id, req.user.school_id]
    );
    if (!typeCheck.rows.length) {
      return res.status(404).json({ error: 'Exam type not found' });
    }

    // Validate subject belongs to this school
    const subCheck = await db.query(
      'SELECT id FROM subjects WHERE id = $1 AND school_id = $2',
      [subject_id, req.user.school_id]
    );
    if (!subCheck.rows.length) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const { rows } = await db.query(
      `INSERT INTO exam_schedule (school_id, exam_type_id, subject_id, class, exam_date, start_time, end_time, room)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.user.school_id, exam_type_id, subject_id, cls, exam_date || null, start_time || null, end_time || null, room || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create exam schedule error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/exams/schedule/:id — Update exam schedule entry
 */
router.put('/schedule/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { exam_date, start_time, end_time, room } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE exam_schedule
       SET exam_date = COALESCE($1, exam_date),
           start_time = COALESCE($2, start_time),
           end_time = COALESCE($3, end_time),
           room = COALESCE($4, room)
       WHERE id = $5 AND school_id = $6
       RETURNING *`,
      [exam_date || null, start_time || null, end_time || null, room || null, id, req.user.school_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Schedule entry not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Update exam schedule error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/exams/schedule/:id — Delete exam schedule entry
 */
router.delete('/schedule/:id', adminAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await db.query(
      'DELETE FROM exam_schedule WHERE id = $1 AND school_id = $2',
      [id, req.user.school_id]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'Schedule entry not found' });
    }
    res.json({ message: 'Schedule entry deleted' });
  } catch (err) {
    console.error('Delete exam schedule error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/exams/pending/:teacherId — Exams where teacher hasn't entered marks yet
 * Compares exam_schedule against marks table to find gaps.
 */
router.get('/pending/:teacherId', auth, async (req, res) => {
  const { teacherId } = req.params;

  try {
    // Get the classes and subjects assigned to this teacher
    const assignments = await db.query(
      `SELECT tsc.class, tsc.subject_id, s.name as subject_name
       FROM teacher_subject_classes tsc
       JOIN subjects s ON s.id = tsc.subject_id
       WHERE tsc.teacher_id = $1`,
      [teacherId]
    );

    if (!assignments.rows.length) {
      return res.json([]);
    }

    // For each assignment, find scheduled exams without complete marks
    const pending = [];
    for (const assign of assignments.rows) {
      const { rows } = await db.query(
        `SELECT es.*, et.name as exam_type_name, $3::text as subject_name
         FROM exam_schedule es
         JOIN exam_types et ON et.id = es.exam_type_id
         WHERE es.class = $1 AND es.subject_id = $2
           AND es.exam_date <= CURRENT_DATE
           AND NOT EXISTS (
             SELECT 1 FROM marks m
             WHERE m.exam_type = et.name
               AND m.subject = $3
               AND m.student_id IN (SELECT id FROM students WHERE class = $1)
           )
         ORDER BY es.exam_date DESC`,
        [assign.class, assign.subject_id, assign.subject_name]
      );
      pending.push(...rows);
    }

    res.json(pending);
  } catch (err) {
    console.error('Get pending exams error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
