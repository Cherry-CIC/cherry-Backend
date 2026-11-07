const mockFirestore = { collection: jest.fn(), runTransaction: jest.fn() };
jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: mockFirestore }));
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { Shipment } from '../models/Shipment';

describe('collection event persistence', () => {
  let documents: Record<string, Record<string, any>>;
  const timestamp = (time: Date) => ({ toMillis: () => time.getTime() });
  const shipment = { id: 's', orderId: 'o' } as Shipment;
  const repo = new ShipmentRepository();

  beforeEach(() => {
    documents = { 'shipments/s': {}, 'orders/o': { deliveryType: 'pickup_point', shippingCarrier: 'inpost_gb' } };
    mockFirestore.collection.mockImplementation((name) => ({ doc: (id: string) => name + '/' + id }));
    mockFirestore.runTransaction.mockImplementation(async (fn) => {
      const writes: Array<() => void> = [];
      const result = await fn({
        get: async (ref: string) => ({ get: (key: string) => documents[ref][key] }),
        update: (ref: string, data: Record<string, any>) => writes.push(() => {
          Object.entries(data).forEach(([key, value]) => {
            documents[ref][key] = value instanceof Date ? timestamp(value) : value;
          });
        }),
      });
      writes.forEach((write) => write());
      return result;
    });
  });

  const time = (hour: number) => new Date(Date.UTC(2026, 10, 5, hour));
  const event = (status: Shipment['status'], sent: number, collected: number | null) =>
    repo.applyTrackingEvent(shipment, { status }, { shipmentStatus: status }, time(sent), collected === null ? null : time(collected));

  it('starts at customer collection and retains that time after retries', async () => {
    await event('awaiting_collection', 10, null);
    expect(documents['orders/o'].collectedAt).toBeUndefined();
    await event('collected', 14, 12);
    await event('collected', 15, 13);
    expect(documents['orders/o'].collectedAt.toMillis()).toBe(time(12).getTime());
    expect(documents['orders/o'].shipmentStatus).toBe('collected');
  });

  it('orders by Sendcloud time regardless of carrier time or its absence', async () => {
    await event('collected', 14, 12);
    await event('exception', 15, null);
    await event('awaiting_collection', 13, null);
    expect(documents['orders/o'].shipmentStatus).toBe('exception');
    expect(documents['shipments/s'].lastTrackingEventMs).toBe(time(15).getTime());
    expect(documents['orders/o'].collectedAt.toMillis()).toBe(time(12).getTime());
  });

  it('can recover an earlier collection time without reverting a newer status', async () => {
    await event('exception', 15, null);
    await event('collected', 14, 12);
    expect(documents['orders/o'].shipmentStatus).toBe('exception');
    expect(documents['orders/o'].collectedAt.toMillis()).toBe(time(12).getTime());
  });
  const arrivalEvent = (sent: number, arrived: number | null) => repo.applyTrackingEvent(
    shipment, { status: 'awaiting_collection' }, { shipmentStatus: 'awaiting_collection' },
    time(sent), null, arrived == null ? null : time(arrived));

  it('persists arrival plus 72 hours, never extending it on retries', async () => {
    await arrivalEvent(10, 9);
    await arrivalEvent(10, 9);
    await arrivalEvent(12, 11);
    expect(documents['orders/o'].readyForCollectionAt.toMillis()).toBe(time(9).getTime());
    expect(documents['orders/o'].collectionDeadline.toMillis()).toBe(time(81).getTime());
    expect(documents['orders/o'].collectedAt).toBeUndefined();
  });

  it('recovers missing arrival evidence on an equal-timestamp retry', async () => {
    await arrivalEvent(10, null);
    expect(documents['orders/o'].collectionDeadline).toBeUndefined();
    await arrivalEvent(10, 9);
    expect(documents['orders/o'].collectionDeadline.toMillis()).toBe(time(81).getTime());
  });

  it('can shorten an arrival deadline without rolling status back', async () => {
    await arrivalEvent(12, 11);
    await arrivalEvent(10, 9);
    expect(documents['shipments/s'].lastTrackingEventMs).toBe(time(12).getTime());
    expect(documents['orders/o'].collectionDeadline.toMillis()).toBe(time(81).getTime());
  });

  it.each(['collected', 'cancelled', 'returning', 'returned'] as const)('never reopens collection after %s', async status => {
    await arrivalEvent(10, 9);
    await event(status, 12, status === 'collected' ? 11 : null);
    await arrivalEvent(13, 12);
    expect(documents['orders/o'].shipmentStatus).toBe(status);
    expect(documents['orders/o'].collectionDeadline.toMillis()).toBe(time(81).getTime());
  });

  it('rejects conflicting tied events and unordered arrivals', async () => {
    await event('en_route', 10, null);
    await arrivalEvent(10, 9);
    await repo.applyTrackingEvent(shipment, { status: 'awaiting_collection' }, {}, null, null, time(9));
    expect(documents['orders/o'].shipmentStatus).toBe('en_route');
    expect(documents['orders/o'].collectionDeadline).toBeUndefined();
  });

  it('does not mistake a generic delivery or transit retry for customer collection', async () => {
    await arrivalEvent(10, 9);
    await event('delivered', 12, null);
    await event('en_route', 13, null);
    expect(documents['orders/o'].shipmentStatus).toBe('awaiting_collection');
    expect(documents['orders/o'].collectedAt).toBeUndefined();
  });

  it.each([['home', 'inpost_gb'], ['pickup_point', 'other']])('does not apply the InPost locker window to %s %s', async (deliveryType, shippingCarrier) => {
    Object.assign(documents['orders/o'], { deliveryType, shippingCarrier });
    await arrivalEvent(10, 9);
    expect(documents['orders/o'].collectionDeadline).toBeUndefined();
  });

  it('uses the canonical order carrier when the shipment has a display name', async () => {
    documents['shipments/s'].carrier = 'InPost';
    await arrivalEvent(10, 9);
    expect(documents['orders/o'].collectionDeadline.toMillis()).toBe(time(81).getTime());
  });

  it('ignores a collection event with the same ordering timestamp as a different status', async () => {
    await arrivalEvent(10, 9);
    await event('collected', 10, 9);
    expect(documents['orders/o'].shipmentStatus).toBe('awaiting_collection');
    expect(documents['orders/o'].collectedAt).toBeUndefined();
  });

});
