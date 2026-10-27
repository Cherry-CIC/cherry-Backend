import { Shipment } from '../models/Shipment';

export const mapSendcloudStatusToShipmentStatus = (
  statusMessage?: string | null
): Shipment['status'] => {
  const normalized = statusMessage?.trim().toLowerCase() || '';

  // Sendcloud normalizes carrier-specific tracking messages into these
  // status families. Keep the app's smaller status model, but classify each
  // documented family explicitly so new carrier wording cannot look like a
  // successful delivery or silently overwrite a shipment as pending.

  if (normalized.includes('delivered')) {
    return 'delivered';
  }

  if (normalized.includes('shipment collected by customer')) {
    return 'delivered';
  }

  if (
    normalized.includes('out for delivery') ||
    normalized.includes('driver en route')
  ) {
    return 'out_for_delivery';
  }

  if (
    normalized.includes('exception') ||
    normalized.includes('address invalid') ||
    normalized.includes('announcement failed') ||
    normalized.includes('delivery attempt failed') ||
    normalized.includes('delivery delayed') ||
    normalized.includes('error collecting') ||
    normalized.includes('refused by recipient') ||
    normalized.includes('returned to sender') ||
    normalized.includes('return payment failed') ||
    normalized.includes('unable to deliver') ||
    normalized.includes('waiting for the return payment')
  ) {
    return 'exception';
  }

  if (
    normalized.includes('cancelled') ||
    normalized.includes('cancellation request') ||
    normalized.includes('submitting cancellation request')
  ) {
    return 'cancelled';
  }

  if (
    normalized.includes('announced') ||
    normalized.includes('being announced') ||
    normalized.includes('ready to send')
  ) {
    return 'announced';
  }

  if (
    normalized.includes('transit') ||
    normalized.includes('sorting') ||
    normalized.includes('sorted') ||
    normalized.includes('transport') ||
    normalized.includes('customs') ||
    normalized.includes('delivery address changed') ||
    normalized.includes('delivery date changed') ||
    normalized.includes('delivery method changed') ||
    normalized.includes('awaiting customer pickup') ||
    normalized.includes('parcel en route') ||
    normalized.includes('en route to sorting center') ||
    normalized.includes('not sorted')
  ) {
    return 'en_route';
  }

  // Statuses such as "No label" are not yet in transit. Unknown values are
  // kept conservative until a new Sendcloud status is explicitly classified.
  return 'pending';
};
