const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { sendChatNotification } = require('../services/push-notifications');

// GET /api/chat/:userId — Get conversations (list of people chatted with)
router.get('/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Get distinct conversations with last message
    const { rows } = await db.query(
      `SELECT DISTINCT ON (other_user)
        other_user as user_id,
        u.name as user_name,
        u.role as user_role,
        last_message,
        last_time,
        unread_count
       FROM (
         SELECT
           CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END as other_user,
           message as last_message,
           created_at as last_time,
           CASE WHEN receiver_id = $1 AND is_read = false THEN 1 ELSE 0 END as unread_flag
         FROM chat_messages
         WHERE sender_id = $1 OR receiver_id = $1
         ORDER BY created_at DESC
       ) sub
       JOIN users u ON u.id = sub.other_user
       LEFT JOIN LATERAL (
         SELECT COUNT(*) as unread_count
         FROM chat_messages
         WHERE sender_id = sub.other_user AND receiver_id = $1 AND is_read = false
       ) uc ON true
       ORDER BY other_user, last_time DESC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/chat/:userId/:targetId — Get messages between two users
router.get('/:userId/:targetId', auth, async (req, res) => {
  try {
    const { userId, targetId } = req.params;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(
      `SELECT cm.*, u.name as sender_name
       FROM chat_messages cm
       JOIN users u ON u.id = cm.sender_id
       WHERE (cm.sender_id = $1 AND cm.receiver_id = $2)
          OR (cm.sender_id = $2 AND cm.receiver_id = $1)
       ORDER BY cm.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, targetId, limit, offset]
    );

    // Mark messages as read
    await db.query(
      `UPDATE chat_messages SET is_read = true
       WHERE sender_id = $1 AND receiver_id = $2 AND is_read = false`,
      [targetId, userId]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM chat_messages
       WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [userId, targetId]
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows.reverse(), // chronological order
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/chat — Send message
router.post('/', auth, async (req, res) => {
  const { receiver_id, message } = req.body;

  if (!receiver_id || !message) {
    return res.status(400).json({ error: 'receiver_id and message are required' });
  }

  if (message.length > 2000) {
    return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
  }

  // Basic XSS sanitization — strip HTML tags from chat messages
  const sanitizedMessage = message.replace(/<[^>]*>/g, '');

  try {
    const { rows } = await db.query(
      `INSERT INTO chat_messages (school_id, sender_id, receiver_id, message)
       VALUES (
         (SELECT school_id FROM users WHERE id = $1),
         $1, $2, $3
       ) RETURNING *`,
      [req.user.id, receiver_id, sanitizedMessage]
    );

    // Send push notification to receiver (non-blocking)
    try {
      const receiverTokens = await db.query(
        `SELECT fcm_token FROM device_tokens WHERE user_id = $1 AND is_active = true`,
        [receiver_id]
      );
      if (receiverTokens.rows.length) {
        const senderName = req.user.name || 'Someone';
        const tokens = receiverTokens.rows.map(r => r.fcm_token);
        await sendChatNotification(tokens, senderName, sanitizedMessage);
      }
    } catch (pushErr) {
      console.error('[Push] Chat notification error:', pushErr.message);
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
