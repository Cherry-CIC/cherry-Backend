import dotenv from 'dotenv';

dotenv.config();

export const sendcloudConfig = {
  publicKey: process.env.SENDCLOUD_PUBLIC_KEY || '',
  secretKey: process.env.SENDCLOUD_SECRET_KEY || '',
  apiUrl: process.env.SENDCLOUD_API_URL || 'https://panel.sendcloud.sc/api/v2',
};

// Validate configuration
if (!sendcloudConfig.publicKey || !sendcloudConfig.secretKey) {
  console.warn('⚠️  Sendcloud credentials are not configured. Please set SENDCLOUD_PUBLIC_KEY and SENDCLOUD_SECRET_KEY in your .env file.');
}