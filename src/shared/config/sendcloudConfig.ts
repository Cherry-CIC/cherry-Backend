import dotenv from 'dotenv';

dotenv.config();

type SendcloudLabelMode = 'off' | 'test' | 'live';

const parseLabelMode = (): SendcloudLabelMode => {
  const value = (process.env.SENDCLOUD_LABEL_MODE || 'test').toLowerCase();

  if (value === 'off' || value === 'test' || value === 'live') {
    return value;
  }

  console.warn(
    `Invalid SENDCLOUD_LABEL_MODE "${value}". Falling back to test labels.`,
  );
  return 'test';
};

export const sendcloudConfig = {
  mode: (process.env.SENDCLOUD_MODE || 'live').toLowerCase(),
  labelMode: parseLabelMode(),
  publicKey: process.env.SENDCLOUD_PUBLIC_KEY || '',
  secretKey: process.env.SENDCLOUD_SECRET_KEY || '',
  apiUrl: process.env.SENDCLOUD_API_URL || 'https://panel.sendcloud.sc/api/v2',
  servicePointsApiUrl:
    process.env.SENDCLOUD_SERVICE_POINTS_API_URL ||
    'https://servicepoints.sendcloud.sc/api/v2',
  enforcedCarrier: (
    process.env.SENDCLOUD_ENFORCED_CARRIER || 'inpost_gb'
  ).toLowerCase(),
};

// Validate configuration
if (
  sendcloudConfig.mode !== 'mock' &&
  (!sendcloudConfig.publicKey || !sendcloudConfig.secretKey)
) {
  console.warn(
    '⚠️  Sendcloud credentials are not configured. Please set SENDCLOUD_PUBLIC_KEY and SENDCLOUD_SECRET_KEY in your .env file.',
  );
}
