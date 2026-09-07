const admin = require('firebase-admin');

// ══════════════════════════════════════════════════════════════════
// Firebase Cloud Messaging (FCM) Push Notification Service
// FREE — no limits on messages
// ══════════════════════════════════════════════════════════════════

let firebaseApp = null;
let isEnabled = false;

/**
 * Initialize Firebase Admin SDK.
 * Call once on server start. Gracefully handles missing config.
 */
function initFirebase() {
  if (firebaseApp) return;
  try {
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
      serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_FILE);
    } else {
      // Check default file path
      const fs = require('fs');
      const defaultPath = require('path').join(__dirname, '..', 'firebase-sa.json');
      if (fs.existsSync(defaultPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
      }
    }

    if (serviceAccount) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      isEnabled = true;
      console.log('  ✓ Firebase Cloud Messaging initialized');
    } else {
      console.warn('  ⚠ FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled');
    }
  } catch (err) {
    console.error('  ✗ Firebase init error:', err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// CORE SEND FUNCTIONS
// ══════════════════════════════════════════════════════════════════

/**
 * Send push notification to a single device token.
 */
async function sendNotification(fcmToken, title, body, data = {}) {
  if (!isEnabled || !fcmToken) return null;
  try {
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: _stringifyData(data),
      android: {
        priority: 'high',
        notification: {
          channelId: 'edupulse_channel',
          sound: 'default',
          icon: '@mipmap/ic_launcher',
        },
      },
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1 },
        },
      },
    };
    const response = await admin.messaging().send(message);
    return response;
  } catch (err) {
    _handleSendError(err, fcmToken);
    return null;
  }
}

/**
 * Send push notification to multiple device tokens.
 * Handles token batching (FCM limit: 500 per batch).
 */
async function sendToMultiple(fcmTokens, title, body, data = {}) {
  if (!isEnabled || !fcmTokens?.length) return null;

  // Deduplicate tokens
  const uniqueTokens = [...new Set(fcmTokens)];

  try {
    const message = {
      notification: { title, body },
      data: _stringifyData(data),
      android: {
        priority: 'high',
        notification: {
          channelId: 'edupulse_channel',
          sound: 'default',
          icon: '@mipmap/ic_launcher',
        },
      },
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1 },
        },
      },
    };

    // FCM sendEachForMulticast supports up to 500 tokens per call
    const batchSize = 500;
    const results = [];

    for (let i = 0; i < uniqueTokens.length; i += batchSize) {
      const batch = uniqueTokens.slice(i, i + batchSize);
      const response = await admin.messaging().sendEachForMulticast({
        ...message,
        tokens: batch,
      });
      results.push(response);

      // Log failures for cleanup
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            _handleSendError(resp.error, batch[idx]);
          }
        });
      }
    }

    return results;
  } catch (err) {
    console.error('[FCM] sendToMultiple error:', err.message);
    return null;
  }
}

/**
 * Send push notification to a topic.
 * Topic format: 'school_{schoolId}_class_{classId}'
 */
async function sendToTopic(topic, title, body, data = {}) {
  if (!isEnabled || !topic) return null;
  try {
    const message = {
      topic,
      notification: { title, body },
      data: _stringifyData(data),
      android: {
        priority: 'high',
        notification: {
          channelId: 'edupulse_channel',
          sound: 'default',
          icon: '@mipmap/ic_launcher',
        },
      },
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1 },
        },
      },
    };
    const response = await admin.messaging().send(message);
    return response;
  } catch (err) {
    console.error(`[FCM] sendToTopic(${topic}) error:`, err.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// HIGH-LEVEL NOTIFICATION FUNCTIONS
// ══════════════════════════════════════════════════════════════════

/**
 * Notify parent(s) when student is marked absent.
 * Priority: HIGH
 */
async function sendAbsenceNotification(fcmTokens, studentName, date) {
  const title = '⚠️ Absence Alert';
  const body = `${studentName} was marked ABSENT on ${date}`;
  const data = { route: '/attendance', type: 'absence', date };
  return sendToMultiple(
    Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens],
    title,
    body,
    data
  );
}

/**
 * Notify all parents/teachers in a class about a new announcement.
 * Priority: MEDIUM
 */
async function sendAnnouncementNotification(schoolId, classId, title, announcementBody) {
  const topic = classId
    ? `school_${schoolId}_class_${classId}`
    : `school_${schoolId}_all`;
  const data = { route: '/announcements', type: 'announcement' };
  return sendToTopic(topic, `📢 ${title}`, announcementBody.substring(0, 100), data);
}

/**
 * Notify parent about fee due reminder (3 days before).
 * Priority: HIGH
 */
async function sendFeeReminderNotification(fcmTokens, studentName, amount, dueDate) {
  const title = '💰 Fee Due Reminder';
  const body = `₹${amount.toLocaleString()} due for ${studentName} on ${dueDate}`;
  const data = { route: '/fees', type: 'fee_reminder', dueDate };
  return sendToMultiple(
    Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens],
    title,
    body,
    data
  );
}

/**
 * Notify parent about overdue fee.
 * Priority: HIGH
 */
async function sendFeeOverdueNotification(fcmTokens, studentName, amount, dueDate) {
  const title = '🚨 Fee Overdue';
  const body = `₹${amount.toLocaleString()} for ${studentName} was due on ${dueDate}. Please pay immediately.`;
  const data = { route: '/fees', type: 'fee_overdue', dueDate };
  return sendToMultiple(
    Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens],
    title,
    body,
    data
  );
}

/**
 * Notify parents in a class about new homework.
 * Priority: MEDIUM
 */
async function sendHomeworkNotification(schoolId, classId, subject, homeworkTitle) {
  const topic = `school_${schoolId}_class_${classId}`;
  const title = '📝 New Homework';
  const body = `${subject}: ${homeworkTitle}`;
  const data = { route: '/homework', type: 'homework', subject };
  return sendToTopic(topic, title, body, data);
}

/**
 * Notify parent about leave approval/rejection.
 * Priority: MEDIUM
 */
async function sendLeaveStatusNotification(fcmTokens, status, studentName) {
  const emoji = status === 'approved' ? '✅' : '❌';
  const title = `${emoji} Leave ${status.charAt(0).toUpperCase() + status.slice(1)}`;
  const body = `Leave application for ${studentName} has been ${status}`;
  const data = { route: '/leave', type: 'leave_status', status };
  return sendToMultiple(
    Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens],
    title,
    body,
    data
  );
}

/**
 * Notify user about new chat message.
 * Priority: HIGH
 */
async function sendChatNotification(fcmTokens, senderName, messagePreview) {
  const title = `💬 ${senderName}`;
  const body = messagePreview.length > 80
    ? messagePreview.substring(0, 80) + '...'
    : messagePreview;
  const data = { route: '/chat', type: 'chat', senderName };
  return sendToMultiple(
    Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens],
    title,
    body,
    data
  );
}

/**
 * Notify parents about published exam schedule.
 * Priority: MEDIUM
 */
async function sendExamScheduleNotification(schoolId, classId, examTitle) {
  const topic = `school_${schoolId}_class_${classId}`;
  const title = '📋 Exam Schedule Published';
  const body = examTitle;
  const data = { route: '/exams', type: 'exam_schedule' };
  return sendToTopic(topic, title, body, data);
}

// ══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════

/**
 * Ensure all data values are strings (FCM requirement).
 */
function _stringifyData(data) {
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = String(value ?? '');
  }
  return result;
}

/**
 * Handle FCM send errors — mark invalid tokens for cleanup.
 */
function _handleSendError(err, token) {
  const invalidCodes = [
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
  ];

  if (err && invalidCodes.includes(err.code)) {
    // Token is invalid — deactivate it in DB
    _deactivateToken(token).catch(() => {});
  } else if (err) {
    console.error(`[FCM] Send error for token ${token?.substring(0, 20)}...:`, err.message || err.code);
  }
}

/**
 * Mark an invalid token as inactive in the database.
 */
async function _deactivateToken(fcmToken) {
  try {
    const db = require('../db');
    await db.query(
      'UPDATE device_tokens SET is_active = false, updated_at = NOW() WHERE fcm_token = $1',
      [fcmToken]
    );
  } catch (err) {
    // Non-critical — just log
    console.error('[FCM] Failed to deactivate token:', err.message);
  }
}

module.exports = {
  initFirebase,
  sendNotification,
  sendToMultiple,
  sendToTopic,
  sendAbsenceNotification,
  sendAnnouncementNotification,
  sendFeeReminderNotification,
  sendFeeOverdueNotification,
  sendHomeworkNotification,
  sendLeaveStatusNotification,
  sendChatNotification,
  sendExamScheduleNotification,
};
