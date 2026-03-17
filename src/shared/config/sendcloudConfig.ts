import dotenv from 'dotenv';

dotenv.config();

export type SendcloudMode = 'mock' | 'live';

const resolveSendcloudMode = (): SendcloudMode => {
  const configuredMode = process.env.SENDCLOUD_MODE?.toLowerCase();

  if (configuredMode === 'mock' || configuredMode === 'live') {
    return configuredMode;
  }

  return process.env.NODE_ENV === 'production' ? 'live' : 'mock';
};

export const sendcloudConfig = {
  publicKey: process.env.SENDCLOUD_PUBLIC_KEY || '',
  secretKey: process.env.SENDCLOUD_SECRET_KEY || '',
  webhookSecret:
    process.env.SENDCLOUD_WEBHOOK_SECRET ||
    process.env.SENDCLOUD_SECRET_KEY ||
    '',
  apiUrl: process.env.SENDCLOUD_API_URL || 'https://panel.sendcloud.sc/api/v2',
  mode: resolveSendcloudMode(),
};

// Validate configuration
if (
  sendcloudConfig.mode === 'live' &&
  (!sendcloudConfig.publicKey || !sendcloudConfig.secretKey)
) {
  console.warn('⚠️  Sendcloud credentials are not configured. Please set SENDCLOUD_PUBLIC_KEY and SENDCLOUD_SECRET_KEY in your .env file.');
}
