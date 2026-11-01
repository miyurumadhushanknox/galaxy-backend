const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendPasswordResetEmail(toEmail, resetToken) {
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  
  await resend.emails.send({
    from: 'Galaxy <onboarding@resend.dev>',
    to: toEmail,
    subject: 'Reset Your Galaxy Password',
    html: `
      <h2>Password Reset Request</h2>
      <p>Click the link below to reset your password:</p>
      <a href="${resetLink}" style="background:#4F46E5;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">Reset Password</a>
      <p>This link expires in 1 hour.</p>
      <p>If you did not request this, ignore this email.</p>
    `
  });
}

module.exports = { sendPasswordResetEmail };
