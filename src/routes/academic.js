const router    = require('express').Router();
const db        = require('../db');
const auth      = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// ══════════════════════════════════════════════════════════════════
// ACADEMIC YEARS
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/academic/years — List all academic years for the school
 */
router.get('/years', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM academic_years WHERE school_id = $1 ORDER BY start_date DESC`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List academic years error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/academic/years — Create a new academic year (admin only)
 */
router.post('/years', adminAuth, async (req, res) => {
  const { name, start_date, end_date, is_current } = req.body;

  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: 'name, start_date, and end_date are required' });
  }

  if (new Date(start_date) >= new Date(end_date)) {
    return res.status(400).json({ error: 'start_date must be before end_date' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // If setting as current, unset all other current years for this school
    if (is_current) {
      await client.query(
        'UPDATE academic_years SET is_current = false WHERE school_id = $1',
        [req.user.school_id]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.school_id, name.trim(), start_date, end_date, is_current || false]
    );

    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Only one current academic year is allowed per school' });
    }
    console.error('Create academic year error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/academic/years/:id/current — Set an academic year as current (admin only)
 */
router.put('/years/:id/current', adminAuth, async (req, res) => {
  const { id } = req.params;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Unset all current years for this school
    await client.query(
      'UPDATE academic_years SET is_current = false WHERE school_id = $1',
      [req.user.school_id]
    );

    // Set the specified year as current
    const { rows } = await client.query(
      `UPDATE academic_years SET is_current = true
       WHERE id = $1 AND school_id = $2
       RETURNING *`,
      [id, req.user.school_id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Academic year not found' });
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Set current year error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════
// SCHOOL CALENDAR
// ══════════════════════════════════════════════════════════════════

/**
 * GET /api/academic/calendar — Get calendar events/holidays
 * Query params: ?month=1&year=2025&type=holiday
 */
router.get('/calendar', auth, async (req, res) => {
  try {
    const { month, year, type } = req.query;
    const page   = parseInt(req.query.page) || 1;
    const limit  = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM school_calendar WHERE school_id = $1`;
    const params = [req.user.school_id];
    let idx = 2;

    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM date) = $${idx} AND EXTRACT(YEAR FROM date) = $${idx + 1}`;
      params.push(parseInt(month), parseInt(year));
      idx += 2;
    } else if (year) {
      query += ` AND EXTRACT(YEAR FROM date) = $${idx}`;
      params.push(parseInt(year));
      idx++;
    }

    if (type) {
      query += ` AND type = $${idx}`;
      params.push(type);
      idx++;
    }

    const countQuery = query.replace('*', 'COUNT(*)');
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY date LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get calendar error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/academic/calendar — Add calendar event/holiday (admin only)
 */
router.post('/calendar', adminAuth, async (req, res) => {
  const { date, type, title, description, academic_year_id } = req.body;

  if (!date || !type || !title) {
    return res.status(400).json({ error: 'date, type, and title are required' });
  }

  const validTypes = ['holiday', 'event', 'exam', 'half_day'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }

  try {
    // Resolve academic_year_id if not provided
    let yearId = academic_year_id;
    if (!yearId) {
      const yearResult = await db.query(
        'SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true',
        [req.user.school_id]
      );
      yearId = yearResult.rows[0]?.id || null;
    }

    const { rows } = await db.query(
      `INSERT INTO school_calendar (school_id, date, type, title, description, academic_year_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.school_id, date, type, title.trim(), description || null, yearId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An entry already exists for this date and type' });
    }
    console.error('Create calendar entry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /api/academic/calendar/:id — Update a calendar entry (admin only)
 */
router.put('/calendar/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { date, type, title, description } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  const validTypes = ['holiday', 'event', 'exam', 'half_day'];
  if (type && !validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }

  try {
    const { rows } = await db.query(
      `UPDATE school_calendar
       SET date = COALESCE($1, date),
           type = COALESCE($2, type),
           title = $3,
           description = $4
       WHERE id = $5 AND school_id = $6
       RETURNING *`,
      [date || null, type || null, title.trim(), description || null, id, req.user.school_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Calendar entry not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An entry already exists for this date and type' });
    }
    console.error('Update calendar entry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/academic/calendar/:id — Delete a calendar entry (admin only)
 */
router.delete('/calendar/:id', adminAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await db.query(
      'DELETE FROM school_calendar WHERE id = $1 AND school_id = $2',
      [id, req.user.school_id]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'Calendar entry not found' });
    }
    res.json({ message: 'Calendar entry deleted' });
  } catch (err) {
    console.error('Delete calendar entry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/academic/calendar/today — Check if today is a holiday/event
 */
router.get('/calendar/today', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { rows } = await db.query(
      `SELECT * FROM school_calendar WHERE school_id = $1 AND date = $2`,
      [req.user.school_id, today]
    );

    const isHoliday = rows.some(r => r.type === 'holiday');
    const isHalfDay = rows.some(r => r.type === 'half_day');

    res.json({
      date: today,
      is_holiday: isHoliday,
      is_half_day: isHalfDay,
      events: rows
    });
  } catch (err) {
    console.error('Get today calendar error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
