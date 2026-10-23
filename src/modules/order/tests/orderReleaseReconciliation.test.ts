jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('../services/OrderReleaseTaskQueue', () => ({
  OrderReleaseTaskQueue: jest.fn(),
}));

import {
  DEFAULT_RECONCILE_LIMIT,
  MAX_RECONCILE_LIMIT,
  OrderReleaseReconciliationService,
  parseReconcileLimit,
} from '../services/OrderReleaseReconciliationService';

const now = new Date('2026-10-22T12:00:00.000Z');
const order = (id: string, hoursFromNow: number, extra = {}) => {
  const at = new Date(now.getTime() + hoursFromNow * 3_600_000);
  return { id, autoReleaseAt: at, releaseAt: at, ...extra };
};

describe('OrderReleaseReconciliationService', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation();
  afterAll(() => errorSpy.mockRestore());

  const setup = (
    due: ReturnType<typeof order>[][],
    upcoming: ReturnType<typeof order>[] = [],
  ) => {
    const repo = {
      getOrdersByAutoRelease: jest.fn(async (window: string) =>
        window === 'due' ? (due.shift() ?? []) : upcoming,
      ),
      releaseOrderForPayout: jest.fn().mockResolvedValue({ status: 'released' }),
    };
    const releaseService = {
      ensureReleaseTask: jest.fn().mockResolvedValue(undefined),
    };
    return {
      repo,
      releaseService,
      service: new OrderReleaseReconciliationService(
        repo as any,
        releaseService as any,
      ),
    };
  };

  it('releases overdue orders with the expiry trigger', async () => {
    const { repo, service } = setup([[order('a', -5), order('b', -1)]]);

    const summary = await service.reconcile(now);

    expect(repo.releaseOrderForPayout).toHaveBeenCalledWith(
      'a',
      'hold_expired',
      now,
    );
    expect(summary).toMatchObject({ scanned: 2, released: 2, blocked: 0 });
  });

  it('counts blocked and already released orders separately', async () => {
    const { repo, service } = setup([
      [order('a', -5), order('b', -4), order('c', -3)],
    ]);
    repo.releaseOrderForPayout
      .mockResolvedValueOnce({ status: 'blocked', reason: 'payment_flagged' })
      .mockResolvedValueOnce({ status: 'already_released' })
      .mockResolvedValueOnce({ status: 'released' });

    expect(await service.reconcile(now)).toMatchObject({
      blocked: 1,
      alreadyReleased: 1,
      released: 1,
    });
  });

  it('pages with an autoReleaseAt and ID cursor until nothing is due', async () => {
    const first = order('a', -5);
    const { repo, service } = setup([[first], []]);

    await service.reconcile(now);

    expect(repo.getOrdersByAutoRelease).toHaveBeenNthCalledWith(
      1,
      'due',
      now,
      expect.any(Number),
      undefined,
    );
    expect(repo.getOrdersByAutoRelease).toHaveBeenNthCalledWith(
      2,
      'due',
      now,
      expect.any(Number),
      { autoReleaseAt: first.autoReleaseAt, id: 'a' },
    );
  });

  it('never scans more orders than the limit', async () => {
    const { repo, service } = setup([[order('a', -5), order('b', -4)]]);

    const summary = await service.reconcile(now, 2);

    expect(summary.scanned).toBe(2);
    expect(repo.getOrdersByAutoRelease).not.toHaveBeenCalledWith(
      'upcoming',
      expect.anything(),
      expect.anything(),
    );
  });

  it('keeps going when one order fails', async () => {
    const { repo, service } = setup([[order('a', -5), order('b', -4)]]);
    repo.releaseOrderForPayout
      .mockRejectedValueOnce(new Error('firestore'))
      .mockResolvedValueOnce({ status: 'released' });

    expect(await service.reconcile(now)).toMatchObject({
      errors: 1,
      released: 1,
    });
  });

  it('schedules a task only for upcoming orders that have none', async () => {
    const { releaseService, service } = setup(
      [],
      [
        order('missing', 10),
        order('done', 11, { releaseTaskEnqueuedAt: new Date() }),
      ],
    );

    const summary = await service.reconcile(now);

    expect(releaseService.ensureReleaseTask).toHaveBeenCalledTimes(1);
    expect(releaseService.ensureReleaseTask).toHaveBeenCalledWith(
      'missing',
      expect.any(Date),
    );
    expect(summary.tasksScheduled).toBe(1);
  });

  it('counts scheduling failures', async () => {
    const { releaseService, service } = setup([], [order('missing', 10)]);
    releaseService.ensureReleaseTask.mockRejectedValue(new Error('queue down'));

    expect(await service.reconcile(now)).toMatchObject({
      tasksScheduled: 0,
      errors: 1,
    });
  });

  it('validates the limit', () => {
    expect(parseReconcileLimit(undefined)).toBe(DEFAULT_RECONCILE_LIMIT);
    expect(parseReconcileLimit(50)).toBe(50);
    for (const bad of [0, -1, 1.5, '10', null, MAX_RECONCILE_LIMIT + 1]) {
      expect(parseReconcileLimit(bad)).toBeNull();
    }
  });
});
