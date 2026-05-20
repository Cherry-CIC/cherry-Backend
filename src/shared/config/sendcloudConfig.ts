import dotenv from 'dotenv';

dotenv.config();

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseCarrierShippingMethodMap = (
  value: string | undefined,
): Record<string, string> => {
  if (!value) {
    return {};
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((mapping, entry) => {
      const [carrier, methodId] = entry.split('=').map((part) => part.trim());
      if (carrier && methodId) {
        mapping[carrier.toLowerCase()] = methodId;
      }
      return mapping;
    }, {});
};

const enforcedCarrier = (
  process.env.SENDCLOUD_ENFORCED_CARRIER || 'inpost_gb'
).toLowerCase();

const pickupPointShippingMethodIds = parseCarrierShippingMethodMap(
  process.env.SENDCLOUD_PICKUP_POINT_SHIPPING_METHOD_IDS,
);

if (
  process.env.SENDCLOUD_PICKUP_POINT_SHIPPING_METHOD_ID &&
  !pickupPointShippingMethodIds[enforcedCarrier]
) {
  pickupPointShippingMethodIds[enforcedCarrier] =
    process.env.SENDCLOUD_PICKUP_POINT_SHIPPING_METHOD_ID;
}

export const sendcloudConfig = {
  publicKey: process.env.SENDCLOUD_PUBLIC_KEY || '',
  secretKey: process.env.SENDCLOUD_SECRET_KEY || '',
  apiUrl: process.env.SENDCLOUD_API_URL || 'https://panel.sendcloud.sc/api/v2',
  servicePointsApiUrl: process.env.SENDCLOUD_SERVICE_POINTS_API_URL || 'https://servicepoints.sendcloud.sc/api/v2',
  enforcedCarrier,
  pickupPointShippingMethodIds,
  homeShippingMethodId: process.env.SENDCLOUD_HOME_SHIPPING_METHOD_ID || '',
  defaultShippingWeightGrams: parsePositiveInteger(
    process.env.SENDCLOUD_DEFAULT_SHIPPING_WEIGHT_GRAMS,
    1000,
  ),
};

// Validate configuration
if (!sendcloudConfig.publicKey || !sendcloudConfig.secretKey) {
  console.warn('⚠️  Sendcloud credentials are not configured. Please set SENDCLOUD_PUBLIC_KEY and SENDCLOUD_SECRET_KEY in your .env file.');
}
