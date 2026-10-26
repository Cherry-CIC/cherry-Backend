import { mapSendcloudStatusToShipmentStatus } from '../utils/statusMapper';

describe('mapSendcloudStatusToShipmentStatus', () => {
  it.each([
    ['Delivered', 'delivered'],
    ['Shipment collected by customer', 'delivered'],
    ['Driver en route', 'out_for_delivery'],
    ['Address invalid', 'exception'],
    ['Announcement failed', 'exception'],
    ['Delivery attempt failed', 'exception'],
    ['Delivery delayed', 'exception'],
    ['Returned to sender', 'exception'],
    ['Unable to deliver', 'exception'],
    ['Cancellation request', 'cancelled'],
    ['Cancelled upstream', 'cancelled'],
    ['Being announced', 'announced'],
    ['Ready to send', 'announced'],
    ['At customs', 'en_route'],
    ['At sorting centre', 'en_route'],
    ['Awaiting customer pickup', 'en_route'],
    ['Delivery date changed', 'en_route'],
    ['No label', 'pending'],
  ])('maps "%s" to "%s"', (sendcloudStatus, expected) => {
    expect(mapSendcloudStatusToShipmentStatus(sendcloudStatus)).toBe(expected);
  });

  it('handles an unknown status conservatively', () => {
    expect(
      mapSendcloudStatusToShipmentStatus('A new carrier status')
    ).toBe('pending');
  });
});
