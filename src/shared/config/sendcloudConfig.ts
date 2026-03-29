import dotenv from 'dotenv';

dotenv.config();

export const sendcloudConfig = {
  publicKey: process.env.SENDCLOUD_PUBLIC_KEY || '',
  secretKey: process.env.SENDCLOUD_SECRET_KEY || '',
  apiUrl: process.env.SENDCLOUD_API_URL || 'https://panel.sendcloud.sc/api/v2',
  dynamicCheckoutApiUrl: process.env.SENDCLOUD_DYNAMIC_CHECKOUT_API_URL || 'https://panel.sendcloud.sc/api/v3',
  servicePointsApiUrl: process.env.SENDCLOUD_SERVICE_POINTS_API_URL || 'https://servicepoints.sendcloud.sc/api/v2',
  checkoutConfigurationId: process.env.SENDCLOUD_CHECKOUT_CONFIGURATION_ID || '',
  senderCountry: process.env.SENDCLOUD_SENDER_COUNTRY || '',
};

// Validate configuration
if (!sendcloudConfig.publicKey || !sendcloudConfig.secretKey) {
  console.warn('⚠️  Sendcloud credentials are not configured. Please set SENDCLOUD_PUBLIC_KEY and SENDCLOUD_SECRET_KEY in your .env file.');
}
