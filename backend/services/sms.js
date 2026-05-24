const nodemailer = require('nodemailer');

const host = process.env.EMAIL_HOST || 'smtp.qq.com';
const port = parseInt(process.env.EMAIL_PORT || '465');
const user = process.env.EMAIL_USER || '';
const pass = process.env.EMAIL_PASS || '';
const fromName = process.env.EMAIL_FROM || '租借系统';

let transporter = null;
function getTransporter() {
  if (!transporter && user && pass) {
    transporter = nodemailer.createTransport({
      host, port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
}

function isConfigured() {
  return !!(user && pass);
}

async function sendEmail(to, subject, text) {
  if (!isConfigured()) return { success: false, error: 'Email not configured' };
  try {
    const t = getTransporter();
    const result = await Promise.race([
      t.sendMail({ from: `"${fromName}" <${user}>`, to, subject, text }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('邮件发送超时（15秒）')), 15000))
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || 'Unknown email error' };
  }
}

module.exports = { sendEmail, isConfigured };
