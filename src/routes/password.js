const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sendSetPasswordEmail, sendPasswordResetEmail } = require('../services/email');

const APP_URL = process.env.APP_URL || 'http://13.126.4.16';

/**
 * Generate a secure random 64-char hex token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ══════════════════════════════════════════════════════════════════
// POST /api/password/send-setup-link
// Called internally when admin creates a user
// Body: { userId } or { userId, email, userName, schoolName }
// ══════════════════════════════════════════════════════════════════
router.post('/send-setup-link', async (req, res) => {
  const { userId, email, userName, schoolName } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // Get user details if not provided
    const { rows } = await db.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    const userEmail = email || user.email;
    const name = userName || user.name;

    if (!userEmail) {
      return res.status(400).json({
        error: 'No email address found for this user',
        setup_link: `${APP_URL}/set-password?token=MANUAL_LINK_NEEDED`,
      });
    }

    // Invalidate any existing unused tokens for this user
    await db.query(
      `UPDATE password_tokens SET used = true WHERE user_id = $1 AND used = false`,
      [userId]
    );

    // Generate new token — expires in 72 hours for set_password
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    await db.query(
      `INSERT INTO password_tokens (user_id, token, type, expires_at)
       VALUES ($1, $2, 'set_password', $3)`,
      [userId, token, expiresAt]
    );

    // Send email
    const emailResult = await sendSetPasswordEmail(userEmail, name, token, schoolName);

    const setupLink = `${APP_URL}/set-password?token=${token}`;

    res.json({
      success: true,
      email_sent: emailResult.success,
      setup_link: setupLink,
      message: emailResult.success
        ? `Password setup email sent to ${userEmail}`
        : `Email failed (${emailResult.error}). Share this link manually: ${setupLink}`,
    });
  } catch (err) {
    console.error('Send setup link error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /api/password/verify-token/:token
// Validates that a token is valid and not expired
// ══════════════════════════════════════════════════════════════════
router.get('/verify-token/:token', async (req, res) => {
  const { token } = req.params;

  if (!token || token.length !== 64) {
    return res.status(400).json({ valid: false, error: 'Invalid token format' });
  }

  try {
    const { rows } = await db.query(
      `SELECT pt.*, u.name as user_name, u.email as user_email
       FROM password_tokens pt
       JOIN users u ON u.id = pt.user_id
       WHERE pt.token = $1`,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ valid: false, error: 'Token not found' });
    }

    const tokenData = rows[0];

    if (tokenData.used) {
      return res.status(410).json({ valid: false, error: 'This link has already been used' });
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(410).json({ valid: false, error: 'This link has expired. Please contact your school admin for a new one.' });
    }

    res.json({
      valid: true,
      type: tokenData.type,
      user_name: tokenData.user_name,
      user_email: tokenData.user_email,
    });
  } catch (err) {
    console.error('Verify token error:', err);
    res.status(500).json({ valid: false, error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/password/set
// Sets password using token
// Body: { token, password }
// ══════════════════════════════════════════════════════════════════
router.post('/set', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }

  if (!password.trim()) {
    return res.status(400).json({ error: 'Password cannot be empty or whitespace only' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Use a transaction with SELECT FOR UPDATE to prevent race condition on token reuse
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Lock the token row to prevent concurrent usage
      const { rows } = await client.query(
        `SELECT * FROM password_tokens WHERE token = $1 FOR UPDATE`,
        [token]
      );

      if (!rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Invalid token' });
      }

      const tokenData = rows[0];

      if (tokenData.used) {
        await client.query('ROLLBACK');
        return res.status(410).json({ error: 'This link has already been used' });
      }

      if (new Date(tokenData.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return res.status(410).json({ error: 'This link has expired. Please contact your school admin.' });
      }

      // Hash password and update user
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update user password and mark as set
      await client.query(
        `UPDATE users SET password = $1, password_set = true, updated_at = NOW() WHERE id = $2`,
        [hashedPassword, tokenData.user_id]
      );

      // Mark token as used
      await client.query(
        `UPDATE password_tokens SET used = true WHERE id = $1`,
        [tokenData.id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Password set successfully! You can now log in with your new password.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Set password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/password/reset-request
// User requests password reset by email
// Body: { email } or { id }
// ══════════════════════════════════════════════════════════════════
router.post('/reset-request', async (req, res) => {
  const { email, id } = req.body;

  if (!email && !id) {
    return res.status(400).json({ error: 'Email or user ID is required' });
  }

  try {
    let query, params;
    if (email) {
      query = 'SELECT id, name, email FROM users WHERE email = $1 AND is_active = true';
      params = [email];
    } else {
      query = 'SELECT id, name, email FROM users WHERE id = $1 AND is_active = true';
      params = [id.toUpperCase()];
    }

    const { rows } = await db.query(query, params);

    // Always return success to prevent email enumeration
    if (!rows.length || !rows[0].email) {
      return res.json({
        success: true,
        message: 'If an account with that email/ID exists, a password reset link has been sent.',
      });
    }

    const user = rows[0];

    // Invalidate existing reset tokens
    await db.query(
      `UPDATE password_tokens SET used = true WHERE user_id = $1 AND type = 'reset_password' AND used = false`,
      [user.id]
    );

    // Generate token — expires in 1 hour for reset
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

    await db.query(
      `INSERT INTO password_tokens (user_id, token, type, expires_at)
       VALUES ($1, $2, 'reset_password', $3)`,
      [user.id, token, expiresAt]
    );

    // Send email
    await sendPasswordResetEmail(user.email, user.name, token);

    res.json({
      success: true,
      message: 'If an account with that email/ID exists, a password reset link has been sent.',
    });
  } catch (err) {
    console.error('Reset request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/password/resend-setup
// Admin resends setup link to a user
// Body: { userId }
// ══════════════════════════════════════════════════════════════════
router.post('/resend-setup', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.school_id, s.name as school_name
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       WHERE u.id = $1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];

    if (!user.email) {
      return res.status(400).json({ error: 'User has no email address' });
    }

    // Invalidate old tokens
    await db.query(
      `UPDATE password_tokens SET used = true WHERE user_id = $1 AND used = false`,
      [userId]
    );

    // Generate new token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO password_tokens (user_id, token, type, expires_at)
       VALUES ($1, $2, 'set_password', $3)`,
      [userId, token, expiresAt]
    );

    const emailResult = await sendSetPasswordEmail(user.email, user.name, token, user.school_name);
    const setupLink = `${APP_URL}/set-password?token=${token}`;

    res.json({
      success: true,
      email_sent: emailResult.success,
      setup_link: setupLink,
      message: emailResult.success
        ? `Password setup email resent to ${user.email}`
        : `Email failed. Share this link manually: ${setupLink}`,
    });
  } catch (err) {
    console.error('Resend setup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
