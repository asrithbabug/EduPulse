const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { id, password, role } = req.body;
  if (!id || !password || !role)
    return res.status(400).json({ error: 'ID, password and role are required' });

  try {
    // ── Normal login flow ─────────────────────────────────────────
    const { rows } = await db.query(
      'SELECT * FROM users WHERE id = $1 AND role = $2', [id.toUpperCase(), role]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];

    // Check if the user's school is locked (admin cannot login to locked school)
    if (user.school_id && (role === 'admin' || role === 'teacher' || role === 'parent')) {
      const schoolCheck = await db.query(
        'SELECT is_locked, is_active FROM schools WHERE id = $1',
        [user.school_id]
      );
      if (schoolCheck.rows.length) {
        const school = schoolCheck.rows[0];
        if (school.is_locked) {
          return res.status(403).json({
            error: 'Your school account has been locked. Please contact EduPulse support.',
            code: 'SCHOOL_LOCKED',
          });
        }
        if (!school.is_active) {
          return res.status(403).json({
            error: 'Your school account is inactive. Please contact EduPulse support.',
            code: 'SCHOOL_INACTIVE',
          });
        }
      }
    }

    // Check if password has been set
    if (user.password_set === false) {
      return res.status(403).json({
        error: 'Please set your password using the link sent to your email. Contact your school admin if you need a new link.',
        code: 'PASSWORD_NOT_SET',
      });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ error: 'Invalid credentials' });

    // Get extra info based on role
    let extra = {};
    if (role === 'parent') {
      const s = await db.query('SELECT * FROM students WHERE id = $1', [user.id]);
      extra = s.rows[0] || {};
    } else if (role === 'teacher') {
      const t = await db.query('SELECT * FROM teachers WHERE id = $1', [user.id]);
      const c = await db.query('SELECT class FROM teacher_classes WHERE teacher_id = $1', [user.id]);
      extra = { ...t.rows[0], classes: c.rows.map(r => r.class) };
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, school_id: user.school_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: {
        id:       user.id,
        name:     user.name,
        email:    user.email,
        phone:    user.phone,
        role:     user.role,
        password_set: user.password_set,
        ...extra,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
