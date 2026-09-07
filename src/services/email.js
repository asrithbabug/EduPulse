const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const ses = new SESClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@edupulse.in';
const APP_URL = process.env.APP_URL || 'http://13.126.4.16';

/**
 * Send password setup email to new user
 */
async function sendSetPasswordEmail(toEmail, userName, token, schoolName) {
  const setPasswordLink = `${APP_URL}/set-password?token=${token}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #5B5FC7 0%, #4648a8 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">EduPulse</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">School Management Platform</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:22px;font-weight:600;">Welcome to EduPulse!</h2>
              <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
                Hi <strong>${userName}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
                Your account has been created${schoolName ? ` at <strong>${schoolName}</strong>` : ''}. 
                Please set your password to get started with EduPulse.
              </p>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:16px 0 32px;">
                    <a href="${setPasswordLink}" 
                       style="display:inline-block;background:#5B5FC7;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:600;box-shadow:0 4px 12px rgba(91,95,199,0.3);">
                      Set Your Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;color:#777;font-size:13px;line-height:1.6;">
                Or copy and paste this link in your browser:
              </p>
              <p style="margin:0 0 24px;background:#f8f9fa;padding:12px 16px;border-radius:6px;word-break:break-all;font-size:13px;color:#5B5FC7;">
                ${setPasswordLink}
              </p>
              <div style="border-top:1px solid #eee;padding-top:20px;margin-top:20px;">
                <p style="margin:0;color:#999;font-size:12px;line-height:1.5;">
                  ⏰ This link expires in <strong>72 hours</strong>. If it expires, contact your school admin for a new link.<br>
                  🔒 If you didn't expect this email, you can safely ignore it.
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fa;padding:24px 40px;text-align:center;border-top:1px solid #eee;">
              <p style="margin:0;color:#999;font-size:12px;">
                © ${new Date().getFullYear()} EduPulse. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textBody = `Welcome to EduPulse!\n\nHi ${userName},\n\nYour account has been created${schoolName ? ` at ${schoolName}` : ''}. Please set your password using the link below:\n\n${setPasswordLink}\n\nThis link expires in 72 hours.\n\nIf you didn't expect this email, you can safely ignore it.\n\n— EduPulse Team`;

  const params = {
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [toEmail],
    },
    Message: {
      Subject: {
        Data: 'Set Your EduPulse Password',
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: htmlBody,
          Charset: 'UTF-8',
        },
        Text: {
          Data: textBody,
          Charset: 'UTF-8',
        },
      },
    },
  };

  try {
    const command = new SendEmailCommand(params);
    const result = await ses.send(command);
    console.log(`✉️  Password setup email sent to ${toEmail} (MessageId: ${result.MessageId})`);
    return { success: true, messageId: result.MessageId };
  } catch (err) {
    console.error(`❌ Failed to send email to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail(toEmail, userName, token) {
  const resetLink = `${APP_URL}/set-password?token=${token}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #5B5FC7 0%, #4648a8 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">EduPulse</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">School Management Platform</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:22px;font-weight:600;">Password Reset Request</h2>
              <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
                Hi <strong>${userName}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
                We received a request to reset your EduPulse password. Click the button below to create a new password.
              </p>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:16px 0 32px;">
                    <a href="${resetLink}" 
                       style="display:inline-block;background:#5B5FC7;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:600;box-shadow:0 4px 12px rgba(91,95,199,0.3);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;color:#777;font-size:13px;line-height:1.6;">
                Or copy and paste this link in your browser:
              </p>
              <p style="margin:0 0 24px;background:#f8f9fa;padding:12px 16px;border-radius:6px;word-break:break-all;font-size:13px;color:#5B5FC7;">
                ${resetLink}
              </p>
              <div style="border-top:1px solid #eee;padding-top:20px;margin-top:20px;">
                <p style="margin:0;color:#999;font-size:12px;line-height:1.5;">
                  ⏰ This link expires in <strong>1 hour</strong>.<br>
                  🔒 If you didn't request this, your account is safe — just ignore this email.
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fa;padding:24px 40px;text-align:center;border-top:1px solid #eee;">
              <p style="margin:0;color:#999;font-size:12px;">
                © ${new Date().getFullYear()} EduPulse. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textBody = `Password Reset Request\n\nHi ${userName},\n\nWe received a request to reset your EduPulse password. Use the link below to create a new password:\n\n${resetLink}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, your account is safe — just ignore this email.\n\n— EduPulse Team`;

  const params = {
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [toEmail],
    },
    Message: {
      Subject: {
        Data: 'Reset Your EduPulse Password',
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: htmlBody,
          Charset: 'UTF-8',
        },
        Text: {
          Data: textBody,
          Charset: 'UTF-8',
        },
      },
    },
  };

  try {
    const command = new SendEmailCommand(params);
    const result = await ses.send(command);
    console.log(`✉️  Password reset email sent to ${toEmail} (MessageId: ${result.MessageId})`);
    return { success: true, messageId: result.MessageId };
  } catch (err) {
    console.error(`❌ Failed to send reset email to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendSetPasswordEmail,
  sendPasswordResetEmail,
};
