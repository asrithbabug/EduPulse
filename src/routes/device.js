const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════════
// Device Token Management for FCM Push Notifications
// ══════════════════════════════════════════════════════════════════

/**
 * POST /api/device/register
 * Register or update an FCM device token for the current user.
 * Called after login and on token refresh.
 */
router.post('/register', auth, async (req, res) => {
  const { fcm_token, device_type, device_id } = req.body;

  if (!fcm_token) {
    return res.status(400).json({ error: 'fcm_token is required' });
  }

  const validTypes = ['android', 'ios', 'web'];
  const type = validTypes.includes(device_type) ? device_type : 'android';

  try {
    // Upsert: if token exists for this user, update it; otherwise insert
    await db.query(
      `INSERT INTO device_tokens (user_id, fcm_token, device_type, device_id, is_active, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT (user_id, fcm_token)
       DO UPDATE SET is_active = true, device_type = $3, device_id = $4, updated_at = NOW()`,
      [req.user.id, fcm_token, type, device_id || null]
    );

    // Also deactivate this token for any OTHER user (token can only belong to one user)
    await db.query(
      `UPDATE device_tokens SET is_active = false, updated_at = NOW()
       WHERE fcm_token = $1 AND user_id != $2`,
      [fcm_token, req.user.id]
    );

    res.json({ success: true, message: 'Device token registered' });
  } catch (err) {
    console.error('[Device] Register token error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/device/unregister
 * Remove/deactivate an FCM token (called on logout).
 */
router.post('/unregister', auth, async (req, res) => {
  const { fcm_token } = req.body;

  if (!fcm_token) {
    return res.status(400).json({ error: 'fcm_token is required' });
  }

  try {
    await db.query(
      `UPDATE device_tokens SET is_active = false, updated_at = NOW()
       WHERE user_id = $1 AND fcm_token = $2`,
      [req.user.id, fcm_token]
    );

    res.json({ success: true, message: 'Device token unregistered' });
  } catch (err) {
    console.error('[Device] Unregister token error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/device/tokens
 * Get all active tokens for current user (for debugging).
 */
router.get('/tokens', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, device_type, device_id, is_active, created_at, updated_at
       FROM device_tokens
       WHERE user_id = $1 AND is_active = true
       ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
