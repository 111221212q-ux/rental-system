const nodemailer = require('nodemailer');

const resendKey = process.env.RESEND_API_KEY || '';
const smtpHost = process.env.EMAIL_HOST || 'smtp.qq.com';
const smtpPort = parseInt(process.env.EMAIL_PORT || '465');
const smtpUser = process.env.EMAIL_USER || '';
const smtpPass = process.env.EMAIL_PASS || '';
const fromName = process.env.EMAIL_FROM || '租借系统';
const fromEmail = process.env.EMAIL_FROM_EMAIL || 'onboarding@resend.dev';

let resendTransporter = null;
let smtpTransporter = null;

function getResendTransporter() {
  if (!resendTransporter && resendKey) {
    resendTransporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 587,
      secure: false,
      auth: { user: 'resend', pass: resendKey },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });
  }
  return resendTransporter;
}

function getSmtpTransporter() {
  if (!smtpTransporter && smtpUser && smtpPass) {
    smtpTransporter = nodemailer.createTransport({
      host: smtpHost, port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });
  }
  return smtpTransporter;
}

function isConfigured() {
  return !!(resendKey || (smtpUser && smtpPass));
}

async function sendEmail(to, subject, text) {
  if (!isConfigured()) return { success: false, error: 'Email not configured' };
  try {
    let t, fromAddr;
    if (resendKey) {
      t = getResendTransporter();
      fromAddr = `"${fromName}" <${fromEmail}>`;
    } else {
      t = getSmtpTransporter();
      fromAddr = `"${fromName}" <${smtpUser}>`;
    }
    if (!t) return { success: false, error: 'Transporter not available' };
    await Promise.race([
      t.sendMail({ from: fromAddr, to, subject, text }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('邮件发送超时（10秒）')), 10000))
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || 'Unknown email error' };
  }
}

module.exports = { sendEmail, isConfigured };
