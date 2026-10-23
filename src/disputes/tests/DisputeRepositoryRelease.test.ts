import { createFakeFirestore } from '../../modules/payment/tests/helpers/fakeFirestore';

const mockFake = createFakeFirestore();

jest.mock('../../shared/config/firebaseConfig', () => ({
  get firestore() {
    return mockFake.firestore;
  },
}));

import { DisputeRepository } from '../DisputeRepository';
import { DisputeAdminError, DisputeSubmissionError } from '../Dispute';

const HOUR = 60 * 60 * 1000;
const deliveredAt = new Date(Date.now() - 2 * HOUR);

const seedOrder = (overrides: Record<string, unknown> = {}) =>
  mockFake.store.set('orders/order-1', {
    userId: 'buyer-1',
    productId: 'product-1',
    productName: 'Coat',
    totalAmount: 1000,
    currency: 'GBP',
    paymentIntentId: 'pi_1',
    paymentStatus: 'succeeded',
    status: 'delivered',
    shipmentStatus: 'delivered',
    payoutStatus: 'held',
    deliveredAt,
    releaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
    autoReleaseAt: new Date(deliveredAt.getTime() + 48 * HOUR),
    ...overrides,
  });
const isScheduled = () =>
  mockFake.store.get('orders/order-1')?.autoReleaseAt instanceof Date;

describe('DisputeRepository hold and release', () => {
  const repo = new DisputeRepository();
  const payoutEvents = () =>
    [...mockFake.store.entries()]
      .filter(([path]) => path.startsWith('orders/order-1/payout_events/'))
      .map(([, data]) => data);
  const submit = () =>
    repo.createBuyerDispute({
      orderId: 'order-1',
      buyerId: 'buyer-1',
      reason: 'wrong_item',
    });

  beforeEach(() => {
    mockFake.store.clear();
    mockFake.store.set('products/product-1', { userId: 'seller-1' });
    mockFake.store.set('payments/pi_1', { status: 'paid' });
  });

  describe('createBuyerDispute', () => {
    it('places a dispute hold on a held order', async () => {
      seedOrder();

      await submit();

      expect(mockFake.store.get('orders/order-1')).toMatchObject({
        buyerDisputeStatus: 'raised',
        payoutHoldReason: 'dispute',
        payoutStatus: 'held',
      });
      expect(isScheduled()).toBe(false);
      expect(payoutEvents()).toEqual([
        expect.objectContaining({
          type: 'hold_placed',
          reason: 'dispute',
          actorRole: 'buyer',
          actorId: 'buyer-1',
        }),
      ]);
    });

    it.each([
      ['the buyer already confirmed', { buyerConfirmedReceived: true }],
      ['the order was released', { payoutStatus: 'ready_for_payout' }],
      [
        'the hold has expired before the release task ran',
        { releaseAt: new Date(Date.now() - 1000) },
      ],
    ])('rejects a dispute when %s', async (_name, overrides) => {
      seedOrder(overrides);

      await expect(submit()).rejects.toMatchObject({
        code: 'dispute_window_closed',
      });
      await expect(submit()).rejects.toBeInstanceOf(DisputeSubmissionError);
      expect(mockFake.store.get('orders/order-1')?.buyerDisputeStatus).toBe(
        undefined,
      );
    });
  });

  describe('moderateDispute outcome', () => {
    const resolve = (outcome?: 'release_to_charity' | 'refund_buyer') =>
      repo.moderateDispute(
        'dispute-1',
        'admin-1',
        'resolved',
        'Reviewed.',
        'key-1',
        outcome,
      );

    const raiseDispute = async (orderOverrides = {}) => {
      seedOrder(orderOverrides);
      const dispute = await submit();
      mockFake.store.set(`disputes/dispute-1`, {
        ...mockFake.store.get(`disputes/${dispute.disputeId}`),
        disputeId: 'dispute-1',
      });
    };

    it('releases the held funds when resolved in favour of the charity', async () => {
      await raiseDispute();

      await resolve('release_to_charity');

      const order = mockFake.store.get('orders/order-1')!;
      expect(order).toMatchObject({
        buyerDisputeStatus: 'resolved',
        payoutStatus: 'ready_for_payout',
        payoutReleaseTrigger: 'dispute_resolution',
      });
      expect(order.payoutHoldReason).not.toBe('dispute');
      expect(isScheduled()).toBe(false);
      expect(mockFake.store.get('disputes/dispute-1')?.resolution).toMatchObject(
        { outcome: 'release_to_charity', resolvedBy: 'admin-1' },
      );
      expect(payoutEvents()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'released',
            actorRole: 'admin',
            actorId: 'admin-1',
            trigger: 'dispute_resolution',
            note: 'Reviewed.',
          }),
        ]),
      );
    });

    it('keeps the funds held when the buyer is refunded', async () => {
      await raiseDispute();

      await resolve('refund_buyer');

      expect(mockFake.store.get('orders/order-1')).toMatchObject({
        buyerDisputeStatus: 'resolved',
        payoutStatus: 'held',
        payoutHoldReason: 'refund',
      });
      expect(isScheduled()).toBe(false);
    });

    it('keeps an existing hold when a buyer dispute is raised', async () => {
      seedOrder({
        payoutHoldReason: 'chargeback',
        payoutHoldReasons: ['chargeback'],
        autoReleaseAt: undefined,
      });

      await submit();

      expect(mockFake.store.get('orders/order-1')).toMatchObject({
        payoutHoldReason: 'chargeback',
        payoutHoldReasons: ['chargeback', 'dispute'],
      });
    });

    it.each([
      ['a refund', 'refund'],
      ['a chargeback', 'chargeback'],
    ])(
      'does not release funds on a dispute resolution while %s hold is active',
      async (_name, reason) => {
        seedOrder({
          payoutHoldReason: reason,
          payoutHoldReasons: [reason],
          autoReleaseAt: undefined,
        });
        const dispute = await submit();
        mockFake.store.set('disputes/dispute-1', {
          ...mockFake.store.get(`disputes/${dispute.disputeId}`),
          disputeId: 'dispute-1',
        });

        await expect(
          repo.moderateDispute(
            'dispute-1',
            'admin-1',
            'resolved',
            'Reviewed.',
            'key-2',
            'release_to_charity',
          ),
        ).rejects.toMatchObject({ code: 'release_blocked' });
        expect(mockFake.store.get('orders/order-1')?.payoutStatus).toBe('held');
      },
    );

    it('keeps other holds when the buyer is refunded', async () => {
      await raiseDispute({
        payoutHoldReason: 'fraud',
        payoutHoldReasons: ['fraud'],
      });

      await resolve('refund_buyer');

      expect(mockFake.store.get('orders/order-1')).toMatchObject({
        payoutStatus: 'held',
        payoutHoldReasons: ['fraud', 'refund'],
      });
    });

    it('refuses to release a flagged payment', async () => {
      await raiseDispute();
      mockFake.store.set('payments/pi_1', { status: 'flagged' });

      await expect(resolve('release_to_charity')).rejects.toMatchObject({
        code: 'release_blocked',
      });
      await expect(resolve('release_to_charity')).rejects.toBeInstanceOf(
        DisputeAdminError,
      );
      expect(mockFake.store.get('orders/order-1')?.payoutStatus).toBe('held');
    });

    it('leaves legacy orders without a payout state untouched', async () => {
      await raiseDispute({ payoutStatus: undefined });

      await resolve('release_to_charity');

      expect(mockFake.store.get('orders/order-1')?.payoutStatus).toBeUndefined();
      expect(mockFake.store.get('orders/order-1')?.buyerDisputeStatus).toBe(
        'resolved',
      );
    });
  });
});
