import { sendcloudConfig } from '../../../shared/config/sendcloudConfig';

export interface ResolvedShippingMethod {
  id: string;
  carrier: string | null;
}

export function normaliseCarrier(value?: string | null): string | null {
  const carrier = String(value || '').trim().toLowerCase();
  return carrier || null;
}

export function resolveConfiguredPickupPointShippingMethod(
  carrierHint?: string | null,
): ResolvedShippingMethod | null {
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
