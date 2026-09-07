const router    = require('express').Router();
const db        = require('../db');
const auth      = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// ══════════════════════════════════════════════════════════════════
// FEE ASSIGNMENT & MANAGEMENT
// Note: Requires schema-v3-fees-fix.sql migration to be applied
// (adds fee_type, receipt_no, payment_mode columns to fees table)
// ══════════════════════════════════════════════════════════════════

// Ensure fee_type column exists (run once on first request)
let feeSchemaChecked = false;
async function ensureFeeSchema() {
  if (feeSchemaChecked) return;
  try {
    await db.query(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS fee_type VARCHAR(50)`);
    await db.query(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS receipt_no VARCHAR(50)`);
    await db.query(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(30)`);
    await db.query(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS description VARCHAR(100)`);
    // Expand status check to include 'pending'
    await db.query(`ALTER TABLE fees DROP CONSTRAINT IF EXISTS fees_status_check`);
    await db.query(`ALTER TABLE fees ADD CONSTRAINT fees_status_check CHECK (status IN ('paid','due','overdue','pending'))`);
    feeSchemaChecked = true;
  } catch (err) {
    // Non-critical — log and continue (columns may already exist)
    console.warn('Fee schema auto-migration note:', err.message);
    feeSchemaChecked = true;
  }
}
ensureFeeSchema();

/**
 * POST /api/fees-mgmt/assign — Assign a fee to a single student (admin only)
 */
router.post('/assign', adminAuth, async (req, res) => {
  const { student_id, fee_type, amount, due_date, description } = req.body;

  if (!student_id || !fee_type || !amount || !due_date) {
    return res.status(400).json({ error: 'student_id, fee_type, amount, and due_date are required' });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  // Validate due_date format
  const parsedDueDate = new Date(due_date);
  if (isNaN(parsedDueDate.getTime())) {
    return res.status(400).json({ error: 'Invalid due_date format' });
  }

  try {
    // Verify student exists and get school_id
    const studentCheck = await db.query(
      'SELECT id, school_id FROM students WHERE id = $1',
      [student_id]
    );
    if (!studentCheck.rows.length) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const { rows } = await db.query(
      `INSERT INTO fees (school_id, student_id, fee_type, amount, due_date, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [studentCheck.rows[0].school_id, student_id, fee_type, amount, due_date, description || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Assign fee error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/fees-mgmt/apply-structure — Apply fee_structure to all students in a class (bulk)
 * Body: { class, fee_type, amount, due_date, description }
 */
router.post('/apply-structure', adminAuth, async (req, res) => {
  const { class: cls, fee_type, amount, due_date, description } = req.body;

  if (!cls || !fee_type || !amount || !due_date) {
    return res.status(400).json({ error: 'class, fee_type, amount, and due_date are required' });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be positive' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Get all students in the class
    const studentsResult = await client.query(
      'SELECT id, school_id FROM students WHERE class = $1 AND school_id = $2',
      [cls, req.user.school_id]
    );

    if (!studentsResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No students found in this class' });
    }

    let inserted = 0;
    for (const student of studentsResult.rows) {
      await client.query(
        `INSERT INTO fees (school_id, student_id, fee_type, amount, due_date, description, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         ON CONFLICT DO NOTHING`,
        [student.school_id, student.id, fee_type, amount, due_date, description || null]
      );
      inserted++;
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `Fee applied to ${inserted} students in class ${cls}`,
      count: inserted
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Apply fee structure error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/fees-mgmt/bulk-assign — Assign fees to multiple students at once
 * Body: { student_ids: [], fee_type, amount, due_date, description }
 */
router.post('/bulk-assign', adminAuth, async (req, res) => {
  const { student_ids, fee_type, amount, due_date, description } = req.body;

  if (!student_ids?.length || !fee_type || !amount || !due_date) {
    return res.status(400).json({ error: 'student_ids (array), fee_type, amount, and due_date are required' });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be positive' });
  }

  if (student_ids.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 students per bulk operation' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let inserted = 0;
    let failed = [];

    for (const studentId of student_ids) {
      try {
        await client.query(
          `INSERT INTO fees (school_id, student_id, fee_type, amount, due_date, description, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
          [req.user.school_id, studentId, fee_type, amount, due_date, description || null]
        );
        inserted++;
      } catch (e) {
        failed.push(studentId);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `Fee assigned to ${inserted} students`,
      inserted,
      failed: failed.length ? failed : undefined
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk assign fee error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/fees-mgmt/:id — Update fee entry (admin only)
 */
router.put('/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { fee_type, amount, due_date, status, description } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE fees
       SET fee_type = COALESCE($1, fee_type),
           amount = COALESCE($2, amount),
           due_date = COALESCE($3, due_date),
           status = COALESCE($4, status),
           description = COALESCE($5, description)
       WHERE id = $6 AND school_id = $7
       RETURNING *`,
      [fee_type || null, amount || null, due_date || null, status || null, description || null, id, req.user.school_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Fee entry not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Update fee error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/fees-mgmt/:id/pay — Record a payment (admin marks as paid)
 * Body: { paid_date, receipt_no, payment_mode }
 */
router.put('/:id/pay', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { paid_date, receipt_no, payment_mode } = req.body;

  if (!paid_date) {
    return res.status(400).json({ error: 'paid_date is required' });
  }

  try {
    // Check if fee already paid
    const feeCheck = await db.query(
      'SELECT status FROM fees WHERE id = $1 AND school_id = $2',
      [id, req.user.school_id]
    );
    if (!feeCheck.rows.length) {
      return res.status(404).json({ error: 'Fee entry not found' });
    }
    if (feeCheck.rows[0].status === 'paid') {
      return res.status(400).json({ error: 'This fee has already been paid' });
    }

    const { rows } = await db.query(
      `UPDATE fees
       SET status = 'paid',
           paid_date = $1,
           receipt_no = $2,
           payment_mode = $3
       WHERE id = $4 AND school_id = $5
       RETURNING *`,
      [paid_date, receipt_no || null, payment_mode || null, id, req.user.school_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Fee entry not found' });
    }
    res.json({ message: 'Payment recorded', fee: rows[0] });
  } catch (err) {
    console.error('Record payment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/fees-mgmt/:id — Delete a fee entry (admin only)
 */
router.delete('/:id', adminAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // Only allow deletion of unpaid fees
    const feeCheck = await db.query(
      'SELECT status FROM fees WHERE id = $1 AND school_id = $2',
      [id, req.user.school_id]
    );

    if (!feeCheck.rows.length) {
      return res.status(404).json({ error: 'Fee entry not found' });
    }

    if (feeCheck.rows[0].status === 'paid') {
      return res.status(400).json({ error: 'Cannot delete a paid fee. Use reversal instead.' });
    }

    await db.query('DELETE FROM fees WHERE id = $1', [id]);
    res.json({ message: 'Fee entry deleted' });
  } catch (err) {
    console.error('Delete fee error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/fees-mgmt/overdue — Get all overdue fees (for reminder automation)
 * Query params: ?class=10-A&days_overdue=30
 */
router.get('/overdue', adminAuth, async (req, res) => {
  try {
    const { class: cls, days_overdue } = req.query;
    const page   = parseInt(req.query.page) || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let query = `
      SELECT f.*, u.name as student_name, s.class, s.roll_no,
             (CURRENT_DATE - f.due_date) as days_past_due
      FROM fees f
      JOIN students s ON s.id = f.student_id
      JOIN users u ON u.id = f.student_id
      WHERE f.school_id = $1
        AND f.status = 'pending'
        AND f.due_date < CURRENT_DATE`;
    const params = [req.user.school_id];
    let idx = 2;

    if (cls) {
      query += ` AND s.class = $${idx}`;
      params.push(cls);
      idx++;
    }

    if (days_overdue) {
      query += ` AND (CURRENT_DATE - f.due_date) >= $${idx}`;
      params.push(parseInt(days_overdue));
      idx++;
    }

    const countQuery = query.replace(
      /SELECT f\.\*, u\.name as student_name, s\.class, s\.roll_no,\s*\(CURRENT_DATE - f\.due_date\) as days_past_due/,
      'SELECT COUNT(*)'
    );
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY f.due_date ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    // Summary
    const summaryResult = await db.query(
      `SELECT COUNT(*) as total_overdue, COALESCE(SUM(amount), 0) as total_amount
       FROM fees WHERE school_id = $1 AND status = 'pending' AND due_date < CURRENT_DATE`,
      [req.user.school_id]
    );

    res.json({
      summary: summaryResult.rows[0],
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get overdue fees error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
