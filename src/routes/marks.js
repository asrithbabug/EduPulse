const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// POST /api/marks — Teacher enters marks (bulk)
router.post('/', auth, async (req, res) => {
  const { class: cls, subject, exam_type, academic_year, marks: marksList } = req.body;
  // marks = [{ student_id, marks, total_marks, grade }]

  if (!cls || !subject || !exam_type || !marksList?.length) {
    return res.status(400).json({ error: 'class, subject, exam_type, and marks array are required' });
  }

  // Validate marks entries
  for (const entry of marksList) {
    const totalMarks = entry.total_marks || 100;
    if (entry.marks < 0) {
      return res.status(400).json({ error: `Marks cannot be negative (student: ${entry.student_id})` });
    }
    if (entry.marks > totalMarks) {
      return res.status(400).json({ error: `Marks (${entry.marks}) cannot exceed total_marks (${totalMarks}) for student: ${entry.student_id}` });
    }
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const inserted = [];

      for (const entry of marksList) {
        const { rows } = await client.query(
          `INSERT INTO marks (school_id, student_id, teacher_id, subject, exam_type, marks, total_marks, grade, academic_year)
           VALUES (
             (SELECT school_id FROM users WHERE id = $1),
             $2, $1, $3, $4, $5, $6, $7, $8
           ) RETURNING *`,
          [
            req.user.id,
            entry.student_id,
            subject,
            exam_type,
            entry.marks,
            entry.total_marks || 100,
            entry.grade || null,
            academic_year || null
          ]
        );
        inserted.push(rows[0]);
      }

      await client.query('COMMIT');
      res.status(201).json({ success: true, count: inserted.length, data: inserted });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Bulk marks entry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/marks/:id — Update a mark entry
router.put('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { marks, total_marks, grade } = req.body;

  // Validate marks if provided
  if (marks !== undefined && marks !== null) {
    if (marks < 0) {
      return res.status(400).json({ error: 'Marks cannot be negative' });
    }
    const maxMarks = total_marks || 100;
    if (marks > maxMarks) {
      return res.status(400).json({ error: `Marks (${marks}) cannot exceed total_marks (${maxMarks})` });
    }
  }

  try {
    const { rows } = await db.query(
      `UPDATE marks
       SET marks = COALESCE($1, marks),
           total_marks = COALESCE($2, total_marks),
           grade = COALESCE($3, grade)
       WHERE id = $4
       RETURNING *`,
      [marks, total_marks, grade, id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Mark entry not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Update marks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/marks/class/:classId — Get all marks for a class
router.get('/class/:classId', auth, async (req, res) => {
  try {
    const { classId } = req.params;
    const { subject, exam_type, academic_year } = req.query;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let query = `
      SELECT m.*, u.name as student_name, s.roll_no, s.section
      FROM marks m
      JOIN students s ON s.id = m.student_id
      JOIN users u ON u.id = m.student_id
      WHERE s.class = $1`;
    const params = [classId];
    let paramIndex = 2;

    if (subject) {
      query += ` AND m.subject = $${paramIndex}`;
      params.push(subject);
      paramIndex++;
    }
    if (exam_type) {
      query += ` AND m.exam_type = $${paramIndex}`;
      params.push(exam_type);
      paramIndex++;
    }
    if (academic_year) {
      query += ` AND m.academic_year = $${paramIndex}`;
      params.push(academic_year);
      paramIndex++;
    }

    query += ` ORDER BY s.roll_no, m.subject LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    // Count query
    let countQuery = `
      SELECT COUNT(*) FROM marks m
      JOIN students s ON s.id = m.student_id
      WHERE s.class = $1`;
    const countParams = [classId];
    let countIdx = 2;
    if (subject) { countQuery += ` AND m.subject = $${countIdx}`; countParams.push(subject); countIdx++; }
    if (exam_type) { countQuery += ` AND m.exam_type = $${countIdx}`; countParams.push(exam_type); countIdx++; }
    if (academic_year) { countQuery += ` AND m.academic_year = $${countIdx}`; countParams.push(academic_year); countIdx++; }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get class marks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
