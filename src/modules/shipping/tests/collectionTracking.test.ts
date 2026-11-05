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
    documents = { 'shipments/s': {}, 'orders/o': { deliveryType: 'pickup_point' } };
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
});
