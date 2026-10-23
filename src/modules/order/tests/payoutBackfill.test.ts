import { createFakeFirestore } from '../../payment/tests/helpers/fakeFirestore';

const mockFake = createFakeFirestore();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  get firestore() {
    return mockFake.firestore;
  },
}));

import {
  BackfillOrderSource,
  PayoutBackfillService,
  planBackfill,
} from '../services/PayoutBackfillService';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-10-25T12:00:00.000Z');
const deliveredAt = new Date('2026-10-20T09:00:00.000Z');

const delivered = (overrides: Record<string, unknown> = {}) => ({
  paymentStatus: 'succeeded',
  status: 'delivered',
  shipmentStatus: 'delivered',
  paidAt: new Date('2026-10-15T09:00:00.000Z'),
  ...overrides,
});
const shipment = { status: 'delivered' as const, updatedAt: deliveredAt };

describe('planBackfill', () => {
  it.each([
    ['already migrated', delivered({ payoutStatus: 'held' }), 'already_migrated'],
    ['unpaid', delivered({ paymentStatus: 'pending' }), 'not_paid'],
    ['refunded', delivered({ paymentStatus: 'refunded' }), 'not_paid'],
    [
      'not delivered',
      delivered({ status: 'shipped', shipmentStatus: 'en_route' }),
      'not_delivered',
    ],
  ])('skips an order that is %s', (_name, order, reason) => {
    expect(planBackfill(order, shipment, now)).toEqual({
      action: 'skip',
      reason,
    });
  });

  it('starts the hold from the shipment delivery time', () => {
    expect(planBackfill(delivered(), shipment, now)).toEqual({
      action: 'hold',
      deliveredAt,
      deliveredAtSource: 'shipment',
      releaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
      autoRelease: true,
    });
  });

  it('falls back through the other known times', () => {
    const buyerConfirmedAt = new Date('2026-10-21T10:00:00.000Z');
    const updatedAt = new Date('2026-10-22T10:00:00.000Z');

    expect(
      planBackfill(
        delivered({ deliveredAt: new Date('2026-10-19T00:00:00.000Z') }),
        shipment,
        now,
      ),
    ).toMatchObject({ deliveredAtSource: 'order' });
    expect(
      planBackfill(
        delivered({
          buyerConfirmedReceived: true,
          buyerConfirmedReceivedAt: buyerConfirmedAt,
          updatedAt,
        }),
        null,
        now,
      ),
    ).toMatchObject({ deliveredAtSource: 'buyer_confirmation' });
    expect(planBackfill(delivered({ updatedAt }), null, now)).toMatchObject({
      deliveredAtSource: 'order_update',
    });
    expect(planBackfill(delivered(), null, now)).toMatchObject({
      deliveredAtSource: 'payment',
    });
    expect(
      planBackfill(delivered({ paidAt: undefined }), null, now),
    ).toMatchObject({ deliveredAt: now, deliveredAtSource: 'backfill_time' });
  });

  it('ignores a shipment that is not delivered', () => {
    expect(
      planBackfill(delivered(), { status: 'exception', updatedAt: now }, now),
    ).toMatchObject({ deliveredAtSource: 'payment' });
  });

  it('honours an earlier buyer confirmation by ending the hold then', () => {
    const confirmedAt = new Date(deliveredAt.getTime() + HOUR);

    expect(
      planBackfill(
        delivered({
          buyerConfirmedReceived: true,
          buyerConfirmedReceivedAt: confirmedAt,
        }),
        shipment,
        now,
      ),
    ).toMatchObject({ releaseAt: confirmedAt, autoRelease: true });
  });

  it('keeps a disputed order on a dispute hold with no automatic release', () => {
    expect(
      planBackfill(
        delivered({
          buyerDisputeId: 'd1',
          buyerDisputeStatus: 'resolved',
          buyerConfirmedReceived: true,
        }),
        shipment,
        now,
      ),
    ).toMatchObject({
      holdReason: 'dispute',
      autoRelease: false,
      releaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
    });
  });

  it('uses the configured hold period', () => {
    expect(planBackfill(delivered(), shipment, now, 72)).toMatchObject({
      releaseAt: new Date(deliveredAt.getTime() + 72 * HOUR),
    });
  });
});

describe('PayoutBackfillService', () => {
  const seed = (id: string, data: Record<string, unknown>) =>
    mockFake.store.set(`orders/${id}`, data);
  const events = (id: string) =>
    [...mockFake.store.entries()]
      .filter(([path]) => path.startsWith(`orders/${id}/payout_events/`))
      .map(([, data]) => data);

  const sourceFor = (): BackfillOrderSource => ({
    listPaidOrders: async (afterId, limit) =>
      [...mockFake.store.entries()]
        .filter(([path]) => /^orders\/[^/]+$/.test(path))
        .map(([path, data]) => ({ id: path.split('/')[1], data }))
        .filter(({ id }) => !afterId || id > afterId)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit),
    getShipment: async () => shipment,
  });

  beforeEach(() => {
    mockFake.store.clear();
    seed('a-delivered', delivered());
    seed('b-disputed', delivered({ buyerDisputeId: 'd1' }));
    seed('c-shipped', delivered({ status: 'shipped', shipmentStatus: 'en_route' }));
    seed('d-migrated', delivered({ payoutStatus: 'held' }));
    seed('e-unpaid', delivered({ paymentStatus: 'pending' }));
  });

  it('changes nothing in a dry run but reports the plan', async () => {
    const planned: string[] = [];

    const summary = await new PayoutBackfillService(sourceFor()).run({
      apply: false,
      now,
      onPlan: (id, plan) => plan.action === 'hold' && planned.push(id),
    });

    expect(planned).toEqual(['a-delivered', 'b-disputed']);
    expect(summary).toEqual({
      scanned: 5,
      held: 2,
      disputed: 1,
      skipped: { already_migrated: 1, not_paid: 1, not_delivered: 1 },
      errors: 0,
    });
    expect(mockFake.store.get('orders/a-delivered')?.payoutStatus).toBeUndefined();
    expect(events('a-delivered')).toEqual([]);
  });

  it('writes the hold, the delivery time and an audit event when applied', async () => {
    await new PayoutBackfillService(sourceFor()).run({ apply: true, now });

    expect(mockFake.store.get('orders/a-delivered')).toMatchObject({
      payoutStatus: 'held',
      deliveredAt,
      releaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
      autoReleaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
    });
    expect(events('a-delivered')).toEqual([
      expect.objectContaining({
        type: 'hold_started',
        actorRole: 'system',
        note: expect.stringContaining('delivery time taken from shipment'),
      }),
    ]);
  });

  it('puts a disputed order on a dispute hold outside the scheduled run', async () => {
    await new PayoutBackfillService(sourceFor()).run({ apply: true, now });

    const disputed = mockFake.store.get('orders/b-disputed')!;
    expect(disputed).toMatchObject({
      payoutStatus: 'held',
      payoutHoldReason: 'dispute',
    });
    expect(disputed.autoReleaseAt).toBeUndefined();
  });

  it('leaves orders that are undelivered, unpaid or already migrated alone', async () => {
    await new PayoutBackfillService(sourceFor()).run({ apply: true, now });

    expect(mockFake.store.get('orders/c-shipped')?.payoutStatus).toBeUndefined();
    expect(mockFake.store.get('orders/e-unpaid')?.payoutStatus).toBeUndefined();
    expect(events('d-migrated')).toEqual([]);
  });

  it('is safe to repeat', async () => {
    const service = new PayoutBackfillService(sourceFor());
    await service.run({ apply: true, now });
    const second = await service.run({ apply: true, now });

    expect(second.held).toBe(0);
    expect(second.skipped.already_migrated).toBe(3);
    expect(events('a-delivered')).toHaveLength(1);
  });

  it('does not overwrite an order migrated while the run was planning', async () => {
    const source = sourceFor();
    const racing: BackfillOrderSource = {
      ...source,
      getShipment: async (id) => {
        mockFake.store.set(`orders/${id}`, {
          ...mockFake.store.get(`orders/${id}`),
          payoutStatus: 'ready_for_payout',
        });
        return shipment;
      },
    };

    const summary = await new PayoutBackfillService(racing).run({
      apply: true,
      now,
    });

    expect(mockFake.store.get('orders/a-delivered')?.payoutStatus).toBe(
      'ready_for_payout',
    );
    expect(summary.held).toBe(0);
  });

  it('stops at the limit and pages through large sets', async () => {
    const limited = await new PayoutBackfillService(sourceFor()).run({
      apply: false,
      now,
      limit: 2,
    });
    expect(limited.scanned).toBe(2);

    const paged = await new PayoutBackfillService(sourceFor()).run({
      apply: false,
      now,
      pageSize: 2,
    });
    expect(paged.scanned).toBe(5);
  });

  it('counts a failing order and carries on', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const source = sourceFor();
    const failing: BackfillOrderSource = {
      ...source,
      getShipment: jest
        .fn()
        .mockRejectedValueOnce(new Error('firestore'))
        .mockResolvedValue(shipment),
    };

    const summary = await new PayoutBackfillService(failing).run({
      apply: false,
      now,
    });

    expect(summary.errors).toBe(1);
    expect(summary.held).toBe(1);
    errorSpy.mockRestore();
  });
});
