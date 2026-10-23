import { createFakeFirestore } from '../../payment/tests/helpers/fakeFirestore';

const mockFake = createFakeFirestore();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  get firestore() {
    return mockFake.firestore;
  },
}));

import { OrderRepository } from '../repositories/OrderRepository';
import {
  calculateReleaseAt,
  DEFAULT_HOLD_PERIOD_HOURS,
  getHoldPeriodHours,
} from '../../../shared/config/orderReleaseConfig';
import { evaluatePayoutRelease } from '../services/payoutRelease';

const HOUR = 60 * 60 * 1000;
const deliveredAt = new Date('2026-10-20T10:00:00.000Z');

const heldOrder = (overrides: Record<string, unknown> = {}) => ({
  userId: 'buyer-1',
  paymentIntentId: 'pi_1',
  paymentStatus: 'succeeded',
  status: 'delivered',
  payoutStatus: 'held',
  deliveredAt,
  releaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
  autoReleaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
  ...overrides,
});
const isScheduled = (order: Record<string, unknown> | undefined) =>
  order?.autoReleaseAt instanceof Date;

describe('hold period configuration', () => {
  const environment = { ...process.env };
  afterEach(() => {
    process.env = { ...environment };
  });

  it('defaults to 48 hours', () => {
    delete process.env.ORDER_HOLD_PERIOD_HOURS;
    expect(getHoldPeriodHours()).toBe(DEFAULT_HOLD_PERIOD_HOURS);
    expect(DEFAULT_HOLD_PERIOD_HOURS).toBe(48);
  });

  it('can be configured', () => {
    process.env.ORDER_HOLD_PERIOD_HOURS = '72';
    expect(getHoldPeriodHours()).toBe(72);
    expect(calculateReleaseAt(deliveredAt).getTime()).toBe(
      deliveredAt.getTime() + 72 * HOUR,
    );
  });

  it.each(['abc', '0', '-5', '100000'])('rejects %s', (value) => {
    process.env.ORDER_HOLD_PERIOD_HOURS = value;
    expect(() => getHoldPeriodHours()).toThrow('ORDER_HOLD_PERIOD_HOURS');
  });
});

describe('evaluatePayoutRelease', () => {
  const now = new Date(deliveredAt.getTime() + 49 * HOUR);
  const evaluate = (
    order: Record<string, unknown>,
    trigger: 'buyer_confirmation' | 'hold_expired' | 'dispute_resolution',
    payment: Record<string, unknown> | null = { status: 'paid' },
    at = now,
  ) => evaluatePayoutRelease({ order, payment, trigger, now: at });

  it('releases an expired hold', () => {
    expect(evaluate(heldOrder(), 'hold_expired').canRelease).toBe(true);
  });

  it('does not release before the hold expires', () => {
    expect(
      evaluate(heldOrder(), 'hold_expired', undefined, new Date(deliveredAt.getTime() + 47 * HOUR)),
    ).toEqual({
      canRelease: false,
      result: { status: 'blocked', reason: 'not_due' },
    });
  });

  it('lets buyer confirmation release before the hold expires', () => {
    expect(
      evaluate(heldOrder(), 'buyer_confirmation', undefined, deliveredAt)
        .canRelease,
    ).toBe(true);
  });

  it('is idempotent once released', () => {
    expect(
      evaluate(heldOrder({ payoutStatus: 'ready_for_payout' }), 'hold_expired'),
    ).toEqual({ canRelease: false, result: { status: 'already_released' } });
  });

  it.each([
    ['an open dispute', { buyerDisputeId: 'd1', buyerDisputeStatus: 'raised' }, 'dispute_open'],
    ['a hold reason', { payoutHoldReason: 'refund' }, 'on_hold'],
    ['an unconfirmed payment', { paymentStatus: 'pending' }, 'payment_not_confirmed'],
    ['no delivery', { deliveredAt: undefined }, 'not_delivered'],
    ['no payout state', { payoutStatus: undefined }, 'not_held'],
  ])('blocks release with %s', (_name, overrides, reason) => {
    for (const trigger of ['hold_expired', 'buyer_confirmation'] as const) {
      expect(evaluate(heldOrder(overrides), trigger)).toEqual({
        canRelease: false,
        result: { status: 'blocked', reason },
      });
    }
  });

  it('blocks a flagged payment on every trigger', () => {
    for (const trigger of [
      'hold_expired',
      'buyer_confirmation',
      'dispute_resolution',
    ] as const) {
      expect(evaluate(heldOrder(), trigger, { status: 'flagged' })).toEqual({
        canRelease: false,
        result: { status: 'blocked', reason: 'payment_flagged' },
      });
    }
  });

  it('lets an admin resolution override a dispute hold', () => {
    const order = heldOrder({
      buyerDisputeId: 'd1',
      buyerDisputeStatus: 'in_progress',
      payoutHoldReason: 'dispute',
    });
    expect(evaluate(order, 'dispute_resolution', undefined, deliveredAt).canRelease).toBe(true);
  });

  it('lets an admin override lift refund, chargeback and fraud holds before the hold expires', () => {
    for (const reason of ['refund', 'chargeback', 'fraud', 'admin']) {
      expect(
        evaluatePayoutRelease({
          order: heldOrder({ payoutHoldReason: reason }),
          payment: { status: 'paid' },
          trigger: 'admin_override',
          now: deliveredAt,
        }).canRelease,
      ).toBe(true);
    }
  });

  it('never lets an admin override skip an unresolved buyer dispute or a flagged payment', () => {
    const disputed = heldOrder({
      buyerDisputeId: 'd1',
      buyerDisputeStatus: 'in_progress',
      payoutHoldReason: 'dispute',
    });
    expect(
      evaluatePayoutRelease({
        order: disputed,
        payment: null,
        trigger: 'admin_override',
        now,
      }),
    ).toEqual({
      canRelease: false,
      result: { status: 'blocked', reason: 'dispute_open' },
    });
    expect(
      evaluatePayoutRelease({
        order: heldOrder(),
        payment: { status: 'flagged' },
        trigger: 'admin_override',
        now,
      }).canRelease,
    ).toBe(false);
  });

  it('keeps a resolved dispute without a release outcome on hold', () => {
    const order = heldOrder({
      buyerDisputeId: 'd1',
      buyerDisputeStatus: 'resolved',
      payoutHoldReason: 'dispute',
    });
    expect(evaluate(order, 'hold_expired').canRelease).toBe(false);
  });

  describe('multiple active holds', () => {
    const disputed = {
      buyerDisputeId: 'd1',
      buyerDisputeStatus: 'in_progress',
    };

    it.each(['refund', 'chargeback', 'fraud', 'admin'])(
      'does not let a dispute resolution lift a %s hold',
      (reason) => {
        const order = heldOrder({
          ...disputed,
          payoutHoldReasons: ['dispute', reason],
          payoutHoldReason: 'dispute',
        });
        expect(evaluate(order, 'dispute_resolution', undefined, deliveredAt)).toEqual({
          canRelease: false,
          result: { status: 'blocked', reason: 'on_hold' },
        });
      },
    );

    it('lets a dispute resolution lift a lone dispute hold', () => {
      const order = heldOrder({ ...disputed, payoutHoldReasons: ['dispute'] });
      expect(
        evaluate(order, 'dispute_resolution', undefined, deliveredAt).canRelease,
      ).toBe(true);
    });

    it('blocks the other triggers while any hold remains', () => {
      const order = heldOrder({ payoutHoldReasons: ['refund'] });
      for (const trigger of ['hold_expired', 'buyer_confirmation'] as const) {
        expect(evaluate(order, trigger).canRelease).toBe(false);
      }
    });

    it('lets an admin override lift every hold', () => {
      expect(
        evaluatePayoutRelease({
          order: heldOrder({ payoutHoldReasons: ['refund', 'chargeback'] }),
          payment: { status: 'paid' },
          trigger: 'admin_override',
          now: deliveredAt,
        }).canRelease,
      ).toBe(true);
    });
  });
});

describe('OrderRepository delivery hold and release', () => {
  const repo = new OrderRepository();
  const eventsOf = (orderId: string) =>
    [...mockFake.store.entries()]
      .filter(([path]) => path.startsWith(`orders/${orderId}/payout_events/`))
      .map(([, data]) => data);

  beforeEach(() => {
    mockFake.store.clear();
  });

  it('records the hold start once', async () => {
    mockFake.store.set('orders/o1', {
      paymentStatus: 'succeeded',
      payoutStatus: 'held',
    });

    await repo.recordDelivery('o1', deliveredAt);
    await repo.recordDelivery('o1', deliveredAt);

    expect(eventsOf('o1')).toEqual([
      expect.objectContaining({
        type: 'hold_started',
        actorRole: 'system',
        toStatus: 'held',
        releaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
      }),
    ]);
  });

  it('records who released the order and why', async () => {
    mockFake.store.set('orders/o1', heldOrder());
    await repo.releaseOrderForPayout('o1', 'buyer_confirmation', deliveredAt);

    expect(eventsOf('o1')).toEqual([
      expect.objectContaining({
        type: 'released',
        actorRole: 'buyer',
        actorId: 'buyer-1',
        fromStatus: 'held',
        toStatus: 'ready_for_payout',
        trigger: 'buyer_confirmation',
      }),
    ]);
  });

  it('records an admin override with the admin, note and overridden hold', async () => {
    mockFake.store.set('orders/o1', heldOrder({ payoutHoldReason: 'refund' }));

    await expect(
      repo.releaseOrderForPayout('o1', 'admin_override', deliveredAt, {
        adminId: 'admin-1',
        note: 'Refund settled offline',
      }),
    ).resolves.toEqual({ status: 'released' });

    expect(mockFake.store.get('orders/o1')).toMatchObject({
      payoutStatus: 'ready_for_payout',
      payoutReleaseTrigger: 'admin_override',
    });
    expect(eventsOf('o1')).toEqual([
      expect.objectContaining({
        type: 'released',
        actorRole: 'admin',
        actorId: 'admin-1',
        trigger: 'admin_override',
        reason: 'refund',
        note: 'Refund settled offline',
      }),
    ]);
  });

  it('records nothing when the release is blocked or repeated', async () => {
    mockFake.store.set('orders/o1', heldOrder({ payoutHoldReason: 'refund' }));
    await repo.releaseOrderForPayout('o1', 'buyer_confirmation', deliveredAt);
    expect(eventsOf('o1')).toEqual([]);
  });

  it('starts the hold on first delivery only', async () => {
    mockFake.store.set('orders/o1', {
      paymentStatus: 'succeeded',
      payoutStatus: 'held',
    });

    const first = await repo.recordDelivery('o1', deliveredAt);
    expect(first.releaseAt?.getTime()).toBe(deliveredAt.getTime() + 48 * HOUR);
    expect(first.releaseTaskPending).toBe(true);
    expect(mockFake.store.get('orders/o1')?.autoReleaseAt).toEqual(
      first.releaseAt,
    );

    const later = new Date(deliveredAt.getTime() + 5 * HOUR);
    const repeat = await repo.recordDelivery('o1', later);
    expect(repeat.releaseAt?.getTime()).toBe(first.releaseAt?.getTime());
    expect(mockFake.store.get('orders/o1')?.deliveredAt).toEqual(deliveredAt);
  });

  it('reports a pending task again until one is recorded', async () => {
    mockFake.store.set('orders/o1', {
      paymentStatus: 'succeeded',
      payoutStatus: 'held',
    });
    await repo.recordDelivery('o1', deliveredAt);
    expect((await repo.recordDelivery('o1')).releaseTaskPending).toBe(true);

    mockFake.store.set('orders/o1', {
      ...mockFake.store.get('orders/o1'),
      releaseTaskEnqueuedAt: new Date(),
    });
    expect((await repo.recordDelivery('o1')).releaseTaskPending).toBe(false);
  });

  it('keeps an order held before delivery out of the scheduled run', async () => {
    mockFake.store.set('orders/o1', {
      paymentStatus: 'succeeded',
      payoutStatus: 'held',
      payoutHoldReason: 'refund',
    });

    const result = await repo.recordDelivery('o1', deliveredAt);

    expect(result.releaseAt).not.toBeNull();
    expect(mockFake.store.get('orders/o1')?.releaseAt).toEqual(result.releaseAt);
    expect(mockFake.store.get('orders/o1')?.autoReleaseAt).toBeUndefined();
  });

  it('holds legacy paid orders that have no payout status', async () => {
    mockFake.store.set('orders/legacy', { paymentStatus: 'succeeded' });
    const result = await repo.recordDelivery('legacy', deliveredAt);
    expect(result.releaseAt).not.toBeNull();
    expect(mockFake.store.get('orders/legacy')?.payoutStatus).toBe('held');
  });

  it('does not hold an unpaid order', async () => {
    mockFake.store.set('orders/unpaid', { paymentStatus: 'pending' });
    const result = await repo.recordDelivery('unpaid', deliveredAt);
    expect(result).toEqual({ releaseAt: null, releaseTaskPending: false });
    expect(mockFake.store.get('orders/unpaid')?.payoutStatus).toBeUndefined();
  });

  it('releases an expired hold once and reports repeats as already released', async () => {
    mockFake.store.set('orders/o1', heldOrder());
    mockFake.store.set('payments/pi_1', { status: 'paid' });
    const due = new Date(deliveredAt.getTime() + 48 * HOUR);

    await expect(
      repo.releaseOrderForPayout('o1', 'hold_expired', due),
    ).resolves.toEqual({ status: 'released' });
    expect(mockFake.store.get('orders/o1')).toMatchObject({
      payoutStatus: 'ready_for_payout',
      payoutReleaseTrigger: 'hold_expired',
      readyForPayoutAt: due,
    });
    await expect(
      repo.releaseOrderForPayout('o1', 'hold_expired', due),
    ).resolves.toEqual({ status: 'already_released' });
  });

  it('keeps an order held until the hold expires', async () => {
    mockFake.store.set('orders/o1', heldOrder());
    const early = new Date(deliveredAt.getTime() + HOUR);

    await expect(
      repo.releaseOrderForPayout('o1', 'hold_expired', early),
    ).resolves.toEqual({ status: 'blocked', reason: 'not_due' });
    expect(mockFake.store.get('orders/o1')?.payoutStatus).toBe('held');
  });

  it('releases early when the buyer confirms', async () => {
    mockFake.store.set('orders/o1', heldOrder());
    await expect(
      repo.releaseOrderForPayout('o1', 'buyer_confirmation', deliveredAt),
    ).resolves.toEqual({ status: 'released' });
  });

  it('never releases an order with an open dispute', async () => {
    mockFake.store.set(
      'orders/o1',
      heldOrder({
        buyerDisputeId: 'd1',
        buyerDisputeStatus: 'raised',
        payoutHoldReason: 'dispute',
      }),
    );
    const due = new Date(deliveredAt.getTime() + 100 * HOUR);
    for (const trigger of ['hold_expired', 'buyer_confirmation'] as const) {
      await expect(
        repo.releaseOrderForPayout('o1', trigger, due),
      ).resolves.toMatchObject({ status: 'blocked' });
    }
    expect(mockFake.store.get('orders/o1')?.payoutStatus).toBe('held');
  });

  it('never releases a flagged payment', async () => {
    mockFake.store.set('orders/o1', heldOrder());
    mockFake.store.set('payments/pi_1', { status: 'flagged' });
    const due = new Date(deliveredAt.getTime() + 100 * HOUR);
    await expect(
      repo.releaseOrderForPayout('o1', 'hold_expired', due),
    ).resolves.toEqual({ status: 'blocked', reason: 'payment_flagged' });
  });

  it('reports a missing order', async () => {
    await expect(
      repo.releaseOrderForPayout('missing', 'hold_expired'),
    ).resolves.toEqual({ status: 'blocked', reason: 'order_not_found' });
  });

  describe('scheduled release eligibility', () => {
    const due = new Date(deliveredAt.getTime() + 49 * HOUR);

    it('removes the order from the scheduled run once released', async () => {
      mockFake.store.set('orders/o1', heldOrder());

      await repo.releaseOrderForPayout('o1', 'buyer_confirmation', deliveredAt);

      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(false);
    });

    it('parks an order the run cannot release so it is not rescanned', async () => {
      mockFake.store.set('orders/o1', heldOrder());
      mockFake.store.set('payments/pi_1', { status: 'flagged' });

      await expect(
        repo.releaseOrderForPayout('o1', 'hold_expired', due),
      ).resolves.toEqual({ status: 'blocked', reason: 'payment_flagged' });

      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(false);
    });

    it('leaves an order scheduled when it is only too early', async () => {
      mockFake.store.set('orders/o1', heldOrder());

      await repo.releaseOrderForPayout('o1', 'hold_expired', deliveredAt);

      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(true);
    });

    it('does not park an order for a manual attempt', async () => {
      mockFake.store.set('orders/o1', heldOrder({ payoutHoldReason: 'refund' }));

      await repo.releaseOrderForPayout('o1', 'buyer_confirmation', due);

      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(true);
    });

    it('takes a held order out of the run and puts it back when the hold clears', async () => {
      mockFake.store.set('orders/o1', heldOrder());

      await repo.placePayoutHold('o1', {
        reason: 'refund',
        actorRole: 'stripe',
      });
      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(false);

      await repo.clearPayoutHold('o1', { reason: 'refund', actorRole: 'stripe' });
      expect(mockFake.store.get('orders/o1')?.autoReleaseAt).toEqual(
        new Date(deliveredAt.getTime() + 48 * HOUR),
      );
    });

    it('does not put an order with an open dispute back into the run', async () => {
      mockFake.store.set(
        'orders/o1',
        heldOrder({
          payoutHoldReason: 'admin',
          autoReleaseAt: undefined,
          buyerDisputeId: 'd1',
          buyerDisputeStatus: 'raised',
        }),
      );

      await repo.clearPayoutHold('o1', { reason: 'admin', actorRole: 'admin' });

      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(false);
    });

    it('takes a released order out of the run when it goes back on hold', async () => {
      mockFake.store.set(
        'orders/o1',
        heldOrder({ payoutStatus: 'ready_for_payout', autoReleaseAt: undefined }),
      );

      await repo.placePayoutHold('o1', { reason: 'fraud', actorRole: 'stripe' });

      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(false);
    });
  });

  describe('payout holds', () => {
    const hold = (reason: 'refund' | 'chargeback' | 'fraud' = 'refund') => ({
      reason,
      actorRole: 'stripe' as const,
      stripeEventId: 'evt_1',
    });

    it('places a hold on a held order and ignores a replay', async () => {
      mockFake.store.set('orders/o1', heldOrder());

      await expect(repo.placePayoutHold('o1', hold())).resolves.toBe('placed');
      await expect(repo.placePayoutHold('o1', hold())).resolves.toBe(
        'unchanged',
      );

      expect(mockFake.store.get('orders/o1')).toMatchObject({
        payoutStatus: 'held',
        payoutHoldReason: 'refund',
      });
      expect(eventsOf('o1')).toEqual([
        expect.objectContaining({
          type: 'hold_placed',
          reason: 'refund',
          actorRole: 'stripe',
          stripeEventId: 'evt_1',
        }),
      ]);
    });

    it('takes a released order back to held before any payout', async () => {
      mockFake.store.set(
        'orders/o1',
        heldOrder({
          payoutStatus: 'ready_for_payout',
          readyForPayoutAt: deliveredAt,
          payoutReleaseTrigger: 'hold_expired',
        }),
      );

      await expect(repo.placePayoutHold('o1', hold('fraud'))).resolves.toBe(
        'placed',
      );

      expect(mockFake.store.get('orders/o1')).toMatchObject({
        payoutStatus: 'held',
        payoutHoldReason: 'fraud',
      });
      expect(eventsOf('o1')[0]).toMatchObject({
        fromStatus: 'ready_for_payout',
        toStatus: 'held',
      });
      await expect(
        repo.releaseOrderForPayout('o1', 'buyer_confirmation', deliveredAt),
      ).resolves.toEqual({ status: 'blocked', reason: 'on_hold' });
    });

    it('keeps an earlier hold reason and also tracks the new one', async () => {
      mockFake.store.set('orders/o1', heldOrder({ payoutHoldReason: 'dispute' }));

      await expect(repo.placePayoutHold('o1', hold('chargeback'))).resolves.toBe(
        'placed',
      );

      expect(mockFake.store.get('orders/o1')).toMatchObject({
        payoutHoldReason: 'dispute',
        payoutHoldReasons: ['dispute', 'chargeback'],
      });
      expect(eventsOf('o1')).toHaveLength(1);
    });

    it('ignores a replay of a reason that is already active', async () => {
      mockFake.store.set('orders/o1', heldOrder());

      await repo.placePayoutHold('o1', hold('chargeback'));
      await repo.placePayoutHold('o1', hold('refund'));
      await expect(repo.placePayoutHold('o1', hold('refund'))).resolves.toBe(
        'unchanged',
      );
      await expect(repo.placePayoutHold('o1', hold('chargeback'))).resolves.toBe(
        'unchanged',
      );

      expect(mockFake.store.get('orders/o1')?.payoutHoldReasons).toEqual([
        'chargeback',
        'refund',
      ]);
      expect(eventsOf('o1')).toHaveLength(2);
    });

    it('stays held and unscheduled until every hold is cleared', async () => {
      const due = new Date(deliveredAt.getTime() + 49 * HOUR);
      mockFake.store.set('orders/o1', heldOrder());
      await repo.placePayoutHold('o1', hold('chargeback'));
      await repo.placePayoutHold('o1', hold('refund'));

      await expect(
        repo.clearPayoutHold('o1', hold('chargeback')),
      ).resolves.toBe('cleared');

      expect(mockFake.store.get('orders/o1')).toMatchObject({
        payoutStatus: 'held',
        payoutHoldReason: 'refund',
        payoutHoldReasons: ['refund'],
      });
      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(false);
      await expect(
        repo.releaseOrderForPayout('o1', 'hold_expired', due),
      ).resolves.toEqual({ status: 'blocked', reason: 'on_hold' });

      await repo.clearPayoutHold('o1', hold('refund'));

      expect(
        Array.isArray(mockFake.store.get('orders/o1')?.payoutHoldReasons),
      ).toBe(false);
      expect(isScheduled(mockFake.store.get('orders/o1'))).toBe(true);
    });

    it('reads a legacy order that only has the single reason field', async () => {
      mockFake.store.set('orders/o1', heldOrder({ payoutHoldReason: 'refund' }));

      await repo.placePayoutHold('o1', hold('fraud'));
      await repo.clearPayoutHold('o1', hold('refund'));

      expect(mockFake.store.get('orders/o1')).toMatchObject({
        payoutHoldReason: 'fraud',
        payoutHoldReasons: ['fraud'],
      });
    });

    it('does not touch orders without a payout state or missing orders', async () => {
      mockFake.store.set('orders/legacy', { paymentStatus: 'succeeded' });

      await expect(repo.placePayoutHold('legacy', hold())).resolves.toBe(
        'not_applicable',
      );
      await expect(repo.placePayoutHold('missing', hold())).resolves.toBe(
        'not_applicable',
      );
    });

    it('clears only the matching hold and does not release the order', async () => {
      mockFake.store.set(
        'orders/o1',
        heldOrder({ payoutHoldReason: 'chargeback' }),
      );

      await expect(
        repo.clearPayoutHold('o1', { ...hold('refund') }),
      ).resolves.toBe('unchanged');
      await expect(
        repo.clearPayoutHold('o1', { ...hold('chargeback') }),
      ).resolves.toBe('cleared');

      expect(mockFake.store.get('orders/o1')?.payoutStatus).toBe('held');
      expect(mockFake.store.get('orders/o1')?.payoutHoldReason).not.toBe(
        'chargeback',
      );
      expect(eventsOf('o1')).toEqual([
        expect.objectContaining({ type: 'hold_cleared', reason: 'chargeback' }),
      ]);
    });
  });
});
