import dotenv from 'dotenv';

dotenv.config();

export const emailConfig = {
  mode: (process.env.EMAIL_MODE || 'off').toLowerCase(),
  resendApiKey: process.env.RESEND_API_KEY || '',
  fromEmail: process.env.RESEND_FROM_EMAIL || '',
};

if (
  emailConfig.mode === 'live' &&
  (!emailConfig.resendApiKey || !emailConfig.fromEmail)
) {
  console.warn(
    'Email is in live mode but RESEND_API_KEY or RESEND_FROM_EMAIL is not configured.',
  );
}
