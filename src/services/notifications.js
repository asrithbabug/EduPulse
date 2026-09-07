const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { SNSClient, PublishCommand }   = require('@aws-sdk/client-sns');
require('dotenv').config();

const ses = new SESClient({ region: process.env.AWS_REGION });
const sns = new SNSClient({ region: process.env.AWS_REGION });

// ── Email ────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const cmd = new SendEmailCommand({
    Source: process.env.SES_FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } },
    },
  });
  return ses.send(cmd);
}

// ── SMS ──────────────────────────────────────────────────────────
async function sendSMS(phone, message) {
  if (process.env.SNS_ENABLED !== 'true') return;
  const cmd = new PublishCommand({
    PhoneNumber: phone,
    Message: message,
    MessageAttributes: {
      'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
    },
  });
  return sns.send(cmd);
}

// ── Absence Alert ────────────────────────────────────────────────
async function sendAbsenceAlert(phone, studentName, date) {
  const msg = `EduPulse Alert: ${studentName} was marked ABSENT on ${date}. Contact school for details.`;
  return sendSMS(phone, msg);
}

// ── Fee Reminder ─────────────────────────────────────────────────
async function sendFeeReminder(email, parentName, studentName, amount, dueDate) {
  return sendEmail({
    to: email,
    subject: `EduPulse: Fee Due Reminder for ${studentName}`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#1E2A6E;padding:24px;border-radius:12px 12px 0 0">
          <h2 style="color:#F5A623;margin:0">EduPulse</h2>
          <p style="color:rgba(255,255,255,.7);margin:4px 0 0">School Management System</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #E8ECF4;border-radius:0 0 12px 12px">
          <p>Dear <strong>${parentName}</strong>,</p>
          <p>This is a reminder that a fee payment of <strong>₹${amount.toLocaleString()}</strong> 
             for <strong>${studentName}</strong> is due on <strong>${dueDate}</strong>.</p>
          <p>Please pay at the school office or contact the admin.</p>
          <p style="color:#888;font-size:12px;margin-top:24px">EduPulse School Management System</p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendEmail, sendSMS, sendAbsenceAlert, sendFeeReminder };
