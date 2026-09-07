const router    = require('express').Router();
const db        = require('../db');
const auth      = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// ══════════════════════════════════════════════════════════════════
// SUBJECT CRUD
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/subjects — List all subjects for the user's school
 */
router.get('/', auth, async (req, res) => {
  try {
    const page   = parseInt(req.query.page) || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const active = req.query.active; // 'true' or 'false'

    let query = `SELECT * FROM subjects WHERE school_id = $1`;
    const params = [req.user.school_id];
    let idx = 2;

    if (active === 'true') {
      query += ` AND is_active = true`;
    } else if (active === 'false') {
      query += ` AND is_active = false`;
    }

    const countQuery = query.replace('*', 'COUNT(*)');
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY name LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('List subjects error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/subjects — Create a new subject (admin only)
 */
router.post('/', adminAuth, async (req, res) => {
  const { name, code, department } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Subject name is required' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO subjects (school_id, name, code, department)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.school_id, name.trim(), code || null, department || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Subject with this name already exists' });
    }
    console.error('Create subject error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/subjects/:id — Update a subject (admin only)
 */
router.put('/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { name, code, department, is_active } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Subject name is required' });
  }

  try {
    const { rows } = await db.query(
      `UPDATE subjects
       SET name = $1, code = $2, department = $3, is_active = $4
       WHERE id = $5 AND school_id = $6
       RETURNING *`,
      [name.trim(), code || null, department || null, is_active !== false, id, req.user.school_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Subject with this name already exists' });
    }
    console.error('Update subject error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/subjects/:id — Deactivate a subject (admin only)
 * Soft delete: sets is_active = false
 */
router.delete('/:id', adminAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await db.query(
      `UPDATE subjects SET is_active = false WHERE id = $1 AND school_id = $2 RETURNING *`,
      [id, req.user.school_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    res.json({ message: 'Subject deactivated', subject: rows[0] });
  } catch (err) {
    console.error('Delete subject error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// CLASS-SUBJECT MAPPING
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/subjects/class/:classId — Get subjects assigned to a specific class
 */
router.get('/class/:classId', auth, async (req, res) => {
  try {
    const { classId } = req.params;

    const { rows } = await db.query(
      `SELECT cs.id as mapping_id, s.*
       FROM class_subjects cs
       JOIN subjects s ON s.id = cs.subject_id
       WHERE cs.school_id = $1 AND cs.class = $2 AND s.is_active = true
       ORDER BY s.name`,
      [req.user.school_id, classId]
    );

    res.json(rows);
  } catch (err) {
    console.error('Get class subjects error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/subjects/assign-class — Assign a subject to a class (admin only)
 */
router.post('/assign-class', adminAuth, async (req, res) => {
  const { class: cls, subject_id } = req.body;

  if (!cls || !subject_id) {
    return res.status(400).json({ error: 'class and subject_id are required' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO class_subjects (school_id, class, subject_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.school_id, cls, subject_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Subject already assigned to this class' });
    }
    console.error('Assign class subject error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/subjects/class/:classId/:subjectId — Remove subject from class
 */
router.delete('/class/:classId/:subjectId', adminAuth, async (req, res) => {
  const { classId, subjectId } = req.params;

  try {
    const { rowCount } = await db.query(
      `DELETE FROM class_subjects WHERE school_id = $1 AND class = $2 AND subject_id = $3`,
      [req.user.school_id, classId, subjectId]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'Mapping not found' });
    }
    res.json({ message: 'Subject removed from class' });
  } catch (err) {
    console.error('Remove class subject error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// TEACHER-SUBJECT MAPPING
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/subjects/teacher/:teacherId — Get subjects assigned to a teacher
 */
router.get('/teacher/:teacherId', auth, async (req, res) => {
  try {
    const { teacherId } = req.params;

    const { rows } = await db.query(
      `SELECT tsc.id as mapping_id, tsc.class, tsc.section,
              s.id as subject_id, s.name as subject_name, s.code as subject_code
       FROM teacher_subject_classes tsc
       JOIN subjects s ON s.id = tsc.subject_id
       WHERE tsc.teacher_id = $1 AND s.is_active = true
       ORDER BY tsc.class, s.name`,
      [teacherId]
    );

    res.json(rows);
  } catch (err) {
    console.error('Get teacher subjects error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/subjects/assign-teacher — Assign teacher to subject+class (admin only)
 */
router.post('/assign-teacher', adminAuth, async (req, res) => {
  const { teacher_id, subject_id, class: cls, section } = req.body;

  if (!teacher_id || !subject_id || !cls) {
    return res.status(400).json({ error: 'teacher_id, subject_id, and class are required' });
  }

  try {
    // Verify teacher exists
    const teacherCheck = await db.query(
      'SELECT id FROM teachers WHERE id = $1',
      [teacher_id]
    );
    if (!teacherCheck.rows.length) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Verify subject exists and belongs to this school
    const subjectCheck = await db.query(
      'SELECT id FROM subjects WHERE id = $1 AND school_id = $2',
      [subject_id, req.user.school_id]
    );
    if (!subjectCheck.rows.length) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const { rows } = await db.query(
      `INSERT INTO teacher_subject_classes (teacher_id, subject_id, class, section)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [teacher_id, subject_id, cls, section || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Teacher already assigned to this subject+class combination' });
    }
    console.error('Assign teacher subject error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
