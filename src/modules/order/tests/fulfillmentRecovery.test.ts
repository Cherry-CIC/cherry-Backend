import { scheduleFulfillmentRecovery } from '../services/FulfillmentRecovery';

describe('scheduleFulfillmentRecovery', () => {
  it('enqueues a fulfilment task for the order', async () => {
    const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };

    await expect(
      scheduleFulfillmentRecovery('order-1', queue as any),
    ).resolves.toBe(true);
    expect(queue.enqueue).toHaveBeenCalledWith('order-1');
  });

  it('never throws when the queue is unavailable or unconfigured', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const queue = {
      enqueue: jest.fn().mockRejectedValue(new Error('not configured')),
    };

    await expect(
      scheduleFulfillmentRecovery('order-1', queue as any),
    ).resolves.toBe(false);
    warnSpy.mockRestore();
  });
});
