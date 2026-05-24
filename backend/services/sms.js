const nodemailer = require('nodemailer');
const https = require('https');

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

function postResend(to, subject, text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ from: `"${fromName}" <${fromEmail}>`, to, subject, text });
    const req = https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { const d = JSON.parse(body); if (res.statusCode >= 400) return reject(new Error(d.message || d.error || 'Resend error')); resolve(d); }
        catch { reject(new Error(body.slice(0,100))) }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTPS request timeout')); });
    req.write(data);
    req.end();
  });
}

async function sendEmail(to, subject, text) {
  if (!isConfigured()) return { success: false, error: 'Email not configured' };
  // Try Resend API first
  if (resendKey) {
    try {
      await Promise.race([
        postResend(to, subject, text),
        new Promise((_, reject) => setTimeout(() => reject(new Error('超时10秒')), 10000))
      ]);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Resend: ' + e.message };
    }
  }
  // Fallback to SMTP
  try {
    const t = nodemailer.createTransport({
      host: smtpHost, port: smtpPort, secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
    });
    await Promise.race([
      t.sendMail({ from: `"${fromName}" <${smtpUser}>`, to, subject, text }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP超时10秒')), 10000))
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, error: 'SMTP: ' + e.message };
  }
}

// Simple connectivity check
async function checkConnectivity() {
  const results = {};
  if (resendKey) {
    try {
      await Promise.race([
        postResend('test@test.com', 'test', 'test'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
      ]);
    } catch (e) {
      results.resendApi = e.message;
    }
  }
  return results;
}

module.exports = { sendEmail, isConfigured, checkConnectivity };
