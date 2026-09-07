const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { sendAnnouncementNotification } = require('../services/push-notifications');

// GET /api/announcements
router.get('/', auth, async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { rows } = await db.query(
      `SELECT a.*, u.name as posted_by_name FROM announcements a
       JOIN users u ON u.id = a.posted_by
       WHERE a.school_id = $1
       ORDER BY a.created_at DESC LIMIT 20`,
      [schoolId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/announcements
router.post('/', auth, async (req, res) => {
  const { title, body, category, important, target_class } = req.body;
  if (!title || !body)
    return res.status(400).json({ error: 'Title and body required' });
  try {
    const schoolId = req.user.school_id;
    // Basic XSS sanitization — strip HTML tags
    const sanitizedTitle = title.replace(/<[^>]*>/g, '');
    const sanitizedBody = body.replace(/<[^>]*>/g, '');
    const { rows } = await db.query(
      `INSERT INTO announcements (school_id, title, body, category, important, target_class, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [schoolId, sanitizedTitle, sanitizedBody, category || 'General', important || false, target_class || null, req.user.id]
    );

    // Send push notification to relevant users (non-blocking)
    try {
      await sendAnnouncementNotification(schoolId, target_class, sanitizedTitle, sanitizedBody);
    } catch (pushErr) {
      console.error('[Push] Announcement notification error:', pushErr.message);
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
