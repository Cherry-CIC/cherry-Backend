import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';

export interface ResolvedShippingMethod {
  id: string;
  carrier: string | null;
}

type CarrierInput = string | Record<string, unknown> | null | undefined;

export function normaliseCarrier(value?: CarrierInput): string | null {
  if (value !== null && value !== undefined && typeof value === 'object') {
    const carrierCode = value.code;
    const carrierName = value.name;
    value =
      typeof carrierCode === 'string'
        ? carrierCode
        : typeof carrierName === 'string'
          ? carrierName
          : null;
  }

  const carrier = String(value || '').trim().toLowerCase();
  return carrier || null;
}

export function resolveConfiguredPickupPointShippingMethod(
  shippingMethodId?: string | null,
  carrierHint?: CarrierInput,
): ResolvedShippingMethod | null {
  const methodId = String(shippingMethodId || '').trim();
  if (methodId) {
    return {
      id: methodId,
      carrier: normaliseCarrier(carrierHint),
    };
  }

  const configuredMethods = sendcloudConfig.pickupPointShippingMethodIds;
  const carrier = normaliseCarrier(carrierHint);

  if (carrier && configuredMethods[carrier]) {
    return {
      id: configuredMethods[carrier],
      carrier,
    };
  }

  const entries = Object.entries(configuredMethods);
  if (entries.length === 1) {
    const [configuredCarrier, id] = entries[0];
    return {
      id,
      carrier: configuredCarrier,
    };
  }

  return null;
}

export function resolveHomeShippingMethodId(
  shippingMethodId?: string | null,
): string | null {
  const methodId = String(
    shippingMethodId || sendcloudConfig.homeShippingMethodId || '',
  ).trim();

  return methodId || null;
}
