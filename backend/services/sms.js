const nodemailer = require('nodemailer');

const resendKey = process.env.RESEND_API_KEY || '';
const smtpHost = process.env.EMAIL_HOST || 'smtp.qq.com';
const smtpPort = parseInt(process.env.EMAIL_PORT || '465');
const smtpUser = process.env.EMAIL_USER || '';
const smtpPass = process.env.EMAIL_PASS || '';
const fromName = process.env.EMAIL_FROM || '租借系统';
const fromEmail = process.env.EMAIL_FROM_EMAIL || 'onboarding@resend.dev';

function isConfigured() {
  return !!(resendKey || (smtpUser && smtpPass));
}

async function sendEmail(to, subject, text) {
  if (!isConfigured()) return { success: false, error: 'Email not configured' };

  // Resend HTTP API (native fetch)
  if (resendKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `"${fromName}" <${fromEmail}>`, to, subject, text }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const d = await r.json();
      if (!r.ok) return { success: false, error: d.message || d.error || 'Resend API error' };
      return { success: true };
    } catch (e) {
      return { success: false, error: e.name === 'AbortError' ? 'Resend API 请求超时' : 'Resend: ' + e.message };
    }
  }

  // SMTP fallback
  try {
    const t = nodemailer.createTransport({
      host: smtpHost, port: smtpPort, secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
    });
    await Promise.race([
      t.sendMail({ from: `"${fromName}" <${smtpUser}>`, to, subject, text }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP超时')), 10000))
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'SMTP: ' + e.message };
  }
}

module.exports = { sendEmail, isConfigured };
