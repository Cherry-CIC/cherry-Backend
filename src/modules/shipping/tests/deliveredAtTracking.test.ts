const mockFirestore = { collection: jest.fn(), runTransaction: jest.fn() };
jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: mockFirestore }));
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { Shipment } from '../models/Shipment';

describe('deliveredAt persistence', () => {
  let documents: Record<string, Record<string, any>>;
  const timestamp = (date: Date) => ({ toMillis: () => date.getTime() });
  const shipment = { id: 's', orderId: 'o' } as Shipment;
  const repo = new ShipmentRepository();
  const time = (hour: number) => new Date(Date.UTC(2026, 10, 5, hour));

  beforeEach(() => {
    documents = { 'shipments/s': {}, 'orders/o': {} };
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

  it('persists deliveredAt only on the first delivered event', async () => {
    await repo.applyTrackingEvent(shipment, { status: 'en_route' }, { shipmentStatus: 'en_route' }, time(10));
    await repo.applyTrackingEvent(shipment, { status: 'delivered' }, { shipmentStatus: 'delivered' }, time(12));
    await repo.applyTrackingEvent(shipment, { status: 'delivered' }, { shipmentStatus: 'delivered' }, time(14));

    expect(documents['shipments/s'].deliveredAt.toMillis()).toBe(time(12).getTime());
    expect(documents['shipments/s'].status).toBe('delivered');
  });
});
