jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('../../../shared/config/stripeConfig', () => ({ stripe: {} }));

import { StripeWebhookService } from '../services/StripeWebhookService';
import {
  isPayoutHoldEvent,
  missingWebhookEvents,
  PAYOUT_HOLD_EVENT_TYPES,
  REQUIRED_WEBHOOK_EVENTS,
} from '../services/payoutHoldEvents';

describe('StripeWebhookService payout holds', () => {
  const orderRepo = {
    getOrderIdByPaymentIntent: jest.fn(),
    placePayoutHold: jest.fn(),
    clearPayoutHold: jest.fn(),
    releaseOrderForPayout: jest.fn(),
  };
  const service = new StripeWebhookService({} as any, orderRepo as any);
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

  const event = (type: string, object: Record<string, unknown>) =>
    ({ id: 'evt_1', type, data: { object } }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepo.getOrderIdByPaymentIntent.mockResolvedValue('order-1');
    orderRepo.placePayoutHold.mockResolvedValue('placed');
    orderRepo.clearPayoutHold.mockResolvedValue('cleared');
  });

  afterAll(() => warnSpy.mockRestore());

  it.each([
    ['charge.refunded', { payment_intent: 'pi_1' }, 'refund'],
    ['charge.dispute.created', { payment_intent: 'pi_1' }, 'chargeback'],
    [
      'radar.early_fraud_warning.created',
      { payment_intent: 'pi_1' },
      'fraud',
    ],
    ['charge.dispute.closed', { payment_intent: 'pi_1', status: 'lost' }, 'chargeback'],
  ])('places a hold for %s', async (type, object, reason) => {
    const outcome = await service.handleEvent(event(type, object));

    expect(orderRepo.getOrderIdByPaymentIntent).toHaveBeenCalledWith('pi_1');
    expect(orderRepo.placePayoutHold).toHaveBeenCalledWith('order-1', {
      reason,
      actorRole: 'stripe',
      stripeEventId: 'evt_1',
    });
    expect(outcome).toMatchObject({
      action: 'payout_hold',
      change: 'placed',
      orderId: 'order-1',
    });
  });

  it('accepts an expanded PaymentIntent object', async () => {
    await service.handleEvent(
      event('charge.refunded', { payment_intent: { id: 'pi_2' } }),
    );
    expect(orderRepo.getOrderIdByPaymentIntent).toHaveBeenCalledWith('pi_2');
  });

  it('reports an unchanged hold when the event is replayed', async () => {
    orderRepo.placePayoutHold.mockResolvedValue('unchanged');
    const outcome = await service.handleEvent(
      event('charge.refunded', { payment_intent: 'pi_1' }),
    );
    expect(outcome).toMatchObject({ change: 'unchanged' });
  });

  it('does nothing for a payment with no order', async () => {
    orderRepo.getOrderIdByPaymentIntent.mockResolvedValue(null);
    const outcome = await service.handleEvent(
      event('charge.refunded', { payment_intent: 'pi_1' }),
    );

    expect(orderRepo.placePayoutHold).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ change: 'no_order', orderId: null });
  });

  it('does nothing for a charge with no PaymentIntent', async () => {
    const outcome = await service.handleEvent(
      event('charge.refunded', { payment_intent: null }),
    );

    expect(orderRepo.getOrderIdByPaymentIntent).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ change: 'no_order' });
  });

  it('lifts the chargeback hold when the dispute is won, then retries the release', async () => {
    const outcome = await service.handleEvent(
      event('charge.dispute.closed', { payment_intent: 'pi_1', status: 'won' }),
    );

    expect(orderRepo.clearPayoutHold).toHaveBeenCalledWith('order-1', {
      reason: 'chargeback',
      actorRole: 'stripe',
      stripeEventId: 'evt_1',
    });
    expect(orderRepo.releaseOrderForPayout).toHaveBeenCalledWith(
      'order-1',
      'hold_expired',
    );
    expect(outcome).toMatchObject({ change: 'cleared' });
  });

  it('does not retry the release when no hold was cleared', async () => {
    orderRepo.clearPayoutHold.mockResolvedValue('unchanged');
    await service.handleEvent(
      event('charge.dispute.closed', { payment_intent: 'pi_1', status: 'won' }),
    );
    expect(orderRepo.releaseOrderForPayout).not.toHaveBeenCalled();
  });

  it('knows which Stripe events affect payout holds', () => {
    expect(isPayoutHoldEvent('charge.refunded')).toBe(true);
    expect(isPayoutHoldEvent('payment_intent.succeeded')).toBe(false);
  });

  describe('webhook subscription', () => {
    it('lists the events an endpoint is missing and keeps the rest', () => {
      expect(
        missingWebhookEvents(['payment_intent.succeeded', 'charge.refunded']),
      ).toEqual([
        'payment_intent.canceled',
        'charge.dispute.created',
        'charge.dispute.closed',
        'radar.early_fraud_warning.created',
      ]);
    });

    it('needs nothing when every event is already enabled', () => {
      expect(missingWebhookEvents([...REQUIRED_WEBHOOK_EVENTS])).toEqual([]);
    });

    it('needs nothing for an endpoint that takes every event', () => {
      expect(missingWebhookEvents(['*'])).toEqual([]);
    });

    it('requires all four hold events plus the payment events', () => {
      expect(REQUIRED_WEBHOOK_EVENTS).toEqual(
        expect.arrayContaining([
          'payment_intent.succeeded',
          'payment_intent.canceled',
          ...PAYOUT_HOLD_EVENT_TYPES,
        ]),
      );
      expect(PAYOUT_HOLD_EVENT_TYPES).toHaveLength(4);
    });
  });
});
