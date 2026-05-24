const nodemailer = require('nodemailer');

const resendKey = process.env.RESEND_API_KEY || '';
const smtpHost = process.env.EMAIL_HOST || 'smtp.qq.com';
const smtpPort = parseInt(process.env.EMAIL_PORT || '465');
const smtpUser = process.env.EMAIL_USER || '';
const smtpPass = process.env.EMAIL_PASS || '';
const fromName = process.env.EMAIL_FROM || '租借系统';
const fromEmail = process.env.EMAIL_FROM_EMAIL || (resendKey ? 'onboarding@resend.dev' : smtpUser);

let transporter = null;
function getTransporter() {
  if (!transporter && smtpUser && smtpPass) {
    transporter = nodemailer.createTransport({
      host: smtpHost, port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 12000,
    });
  }
  return transporter;
}

function isConfigured() {
  return !!(resendKey || (smtpUser && smtpPass));
}

async function sendViaResend(to, subject, text) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `"${fromName}" <${fromEmail}>`, to, subject, text }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || d.error || 'Resend API error');
  return d;
}

async function sendEmail(to, subject, text) {
  if (!isConfigured()) return { success: false, error: 'Email not configured' };
  // Prefer Resend, fallback to SMTP
  if (resendKey) {
    try {
      await Promise.race([
        sendViaResend(to, subject, text),
        new Promise((_, reject) => setTimeout(() => reject(new Error('邮件发送超时（12秒）')), 12000))
      ]);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || 'Unknown Resend error' };
    }
  }
  try {
    const t = getTransporter();
    await Promise.race([
      t.sendMail({ from: `"${fromName}" <${smtpUser}>`, to, subject, text }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('邮件发送超时（12秒）')), 12000))
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || 'Unknown email error' };
  }
}

module.exports = { sendEmail, isConfigured };
