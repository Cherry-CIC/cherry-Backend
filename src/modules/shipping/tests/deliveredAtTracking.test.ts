const mockFirestore = { collection: jest.fn(), runTransaction: jest.fn() };
jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: mockFirestore }));
import { ShipmentRepository } from '../repositories/ShipmentRepository';
import { Shipment } from '../models/Shipment';
import { mapSendcloudStatusToShipmentStatus } from '../utils/statusMapper';

describe('shipment tracking transactions', () => {
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
        get: async (ref: string) => ({
          exists: documents[ref] !== undefined,
          data: () => documents[ref],
          get: (key: string) => key.split('.').reduce((data, field) => data?.[field], documents[ref]),
        }),
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

  describe('buyer locker arrival', () => {
    const arrival = 'Awaiting customer pickup';
    const originalFlag = process.env.COLLECTION_PUSH_ENABLED;
    type CarrierEvent = NonNullable<Parameters<ShipmentRepository['applyTrackingEvent']>[4]>;

    function apply(message: string, eventTime = time(11), details: Partial<CarrierEvent> = {}) {
      const status = mapSendcloudStatusToShipmentStatus(message);
      const currentShipment = { ...documents['shipments/s'], id: shipment.id } as Shipment;
      return repo.applyTrackingEvent(
        currentShipment,
        { status },
        { shipmentStatus: status, shipmentId: shipment.id, status: status === 'delivered' ? 'delivered' : 'shipped' },
        eventTime,
        { message, carrierTime: eventTime, isReturn: false, servicePointId: 55, ...details },
      );
    }

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(time(12));
      process.env.COLLECTION_PUSH_ENABLED = 'true';
      const pickupPoint = { id: '55', name: 'InPost Locker, High Street', country: 'GB', carrier: 'inpost_gb' };
      documents['orders/o'] = {
        userId: 'buyer', status: 'shipped', shipmentStatus: 'en_route', shipmentId: shipment.id,
        paymentStatus: 'succeeded', deliveryType: 'pickup_point', shippingCarrier: 'inpost_gb', pickupPoint,
      };
      documents['shipments/s'] = {
        orderId: shipment.orderId, status: 'en_route', provider: 'sendcloud',
        carrier: 'inpost_gb', deliveryType: 'pickup_point', pickupPoint,
      };
    });

    afterEach(() => {
      jest.useRealTimers();
      if (originalFlag === undefined) delete process.env.COLLECTION_PUSH_ENABLED;
      else process.env.COLLECTION_PUSH_ENABLED = originalFlag;
    });

    it('persists the carrier time on first arrival at the chosen InPost locker', async () => {
      const outcome = await apply(arrival, time(11), { carrierTime: time(10) });
      expect(outcome).toEqual({ updated: true, dispatchLockerReady: true });
      expect(documents['shipments/s']).toMatchObject({
        lockerReadyActive: true, lockerReadyAtMs: time(10).getTime(), status: 'en_route',
      });
      expect(documents['shipments/s'].deliveredAt).toBeUndefined();
    });

    it('permits a retry of the current arrival without extending the collection window', async () => {
      await apply(arrival, time(11), { carrierTime: time(10) });
      const retry = await apply(arrival, time(11), { carrierTime: time(10) });
      expect(retry.dispatchLockerReady).toBe(true);
      expect(documents['shipments/s'].lockerReadyAtMs).toBe(time(10).getTime());
    });

    it('ignores an older arrival following a newer tracking update', async () => {
      await apply('At sorting centre', time(11));
      const outcome = await apply(arrival, time(10));
      expect(outcome).toEqual({ updated: false, dispatchLockerReady: false });
      expect(documents['shipments/s'].lockerReadyActive).not.toBe(true);
    });

    it('does not open collection for an arrival tied with a different tracking update', async () => {
      await apply('At sorting centre', time(11));
      const outcome = await apply(arrival, time(11));
      expect(outcome.dispatchLockerReady).toBe(false);
      expect(documents['shipments/s'].lockerReadyActive).not.toBe(true);
    });

    it.each(['Shipment collected by customer', 'Returned to sender', 'Cancelled'])(
      'stops alerts after %s, even if the arrival is sent again', async (message) => {
        await apply(arrival, time(10));
        expect((await apply(message, time(11))).dispatchLockerReady).toBe(false);
        expect(documents['shipments/s'].lockerReadyActive).not.toBe(true);
        expect((await apply(arrival, time(10))).dispatchLockerReady).toBe(false);
        expect((await apply(arrival, time(11))).dispatchLockerReady).toBe(false);
      },
    );

    it.each(['Delivered', 'Shipment picked up by driver', 'Out for delivery'])(
      'does not treat %s as arrival', async (message) => {
        expect((await apply(message)).dispatchLockerReady).toBe(false);
        expect(documents['shipments/s'].lockerReadyActive).not.toBe(true);
      },
    );

    it('does not dispatch a carrier arrival which is 72 hours old', async () => {
      const expiryBoundary = new Date(Date.now() - 72 * 60 * 60 * 1000);
      expect((await apply(arrival, time(11), { carrierTime: expiryBoundary })).dispatchLockerReady).toBe(false);
    });

    it.each<[string, Partial<CarrierEvent>]>([
      ['a return', { isReturn: true }],
      ['a different locker', { servicePointId: 99 }],
    ])('does not dispatch for %s', async (_, eventChange) => {
      expect((await apply(arrival, time(11), eventChange)).dispatchLockerReady).toBe(false);
    });

    it.each([
      ['another carrier', { shippingCarrier: 'other' }],
      ['a refunded purchase', { paymentStatus: 'refunded' }],
      ['a cancelled purchase', { status: 'cancelled' }],
      ['a dispute', { buyerDisputeStatus: 'raised' }],
    ])('suppresses the alert for %s', async (_, orderChange) => {
      Object.assign(documents['orders/o'], orderChange);
      expect((await apply(arrival)).dispatchLockerReady).toBe(false);
    });

    it.each([
      ['home delivery', { deliveryType: 'home' }],
      ['a collection point overseas', { pickupPoint: { id: '55', country: 'PL', name: 'InPost Locker' } }],
      ['a staffed shop', { pickupPoint: { id: '55', country: 'GB', name: 'High Street Newsagents' } }],
    ])('suppresses the alert for %s', async (_, shipmentChange) => {
      Object.assign(documents['shipments/s'], shipmentChange);
      expect((await apply(arrival)).dispatchLockerReady).toBe(false);
    });

    it('recognises a later arrival after a temporary delivery delay', async () => {
      await apply('Delivery delayed', time(10));
      documents['orders/o'].status = 'failed';
      expect((await apply(arrival)).dispatchLockerReady).toBe(true);
    });

    it('recognises a locker delivery method where the point uses a venue name', async () => {
      documents['shipments/s'].pickupPoint.name = 'High Street Station';
      documents['orders/o'].shippingOptionName = 'InPost Address to Locker';
      expect((await apply(arrival)).dispatchLockerReady).toBe(true);
    });

    it('updates normal tracking without dispatch when the feature is off', async () => {
      delete process.env.COLLECTION_PUSH_ENABLED;
      expect(await apply(arrival)).toEqual({ updated: true, dispatchLockerReady: false });
      expect(documents['shipments/s'].lastTrackingEventMs).toBe(time(11).getTime());
    });
  });
});
