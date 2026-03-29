import { Shipment } from '../models/Shipment';

export const mapSendcloudStatusToShipmentStatus = (
  statusMessage?: string | null
): Shipment['status'] => {
  const normalized = statusMessage?.toLowerCase() || '';

  if (normalized.includes('delivered')) {
    return 'delivered';
  }

  if (normalized.includes('out for delivery')) {
    return 'out_for_delivery';
  }

  if (normalized.includes('exception')) {
    return 'exception';
  }

  if (normalized.includes('cancelled')) {
    return 'cancelled';
  }

  if (normalized.includes('announced')) {
    return 'announced';
  }

  return 'en_route';
};
