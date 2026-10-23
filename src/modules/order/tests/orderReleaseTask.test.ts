const mockVerifyIdToken = jest.fn();

jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import {
  getOrderReleaseTaskConfiguration,
  OrderReleaseTaskQueue,
} from '../services/OrderReleaseTaskQueue';
import { isAuthorizedOrderReleaseTask } from '../services/OrderReleaseTaskAuth';
import { OrderReleaseService } from '../services/OrderReleaseService';
import {
  processOrderReleaseTask,
  reconcileOrderReleases,
} from '../controllers/orderReleaseTaskController';
import { OrderReleaseReconciliationService } from '../services/OrderReleaseReconciliationService';

const setEnvironment = () => {
  process.env.CLOUD_TASKS_PROJECT_ID = 'cherry-test';
  process.env.CLOUD_TASKS_LOCATION = 'europe-west2';
  process.env.CLOUD_TASKS_QUEUE = 'order-fulfillment';
  process.env.ORDER_RELEASE_WORKER_URL =
    'https://cherry.example/api/internal/order-release/tasks';
  process.env.FULFILLMENT_WORKER_AUDIENCE = 'https://cherry.example';
  process.env.FULFILLMENT_WORKER_SERVICE_ACCOUNT =
    'tasks@cherry-test.iam.gserviceaccount.com';
};

const createRes = () => {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

describe('order release Cloud Tasks integration', () => {
  const environment = { ...process.env };

  beforeEach(() => {
    process.env = { ...environment };
    setEnvironment();
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = environment;
  });

  describe('configuration', () => {
    it('reuses the fulfilment queue, audience and service account', () => {
      expect(getOrderReleaseTaskConfiguration()).toEqual({
        projectId: 'cherry-test',
        location: 'europe-west2',
        queue: 'order-fulfillment',
        workerUrl: 'https://cherry.example/api/internal/order-release/tasks',
        audience: 'https://cherry.example',
        serviceAccountEmail: 'tasks@cherry-test.iam.gserviceaccount.com',
      });
    });

    it('prefers dedicated release settings', () => {
      process.env.ORDER_RELEASE_TASKS_QUEUE = 'order-release';
      process.env.ORDER_RELEASE_WORKER_AUDIENCE = 'https://release.example';
      process.env.ORDER_RELEASE_WORKER_SERVICE_ACCOUNT =
        'release@cherry-test.iam.gserviceaccount.com';

      expect(getOrderReleaseTaskConfiguration()).toMatchObject({
        queue: 'order-release',
        audience: 'https://release.example',
        serviceAccountEmail: 'release@cherry-test.iam.gserviceaccount.com',
      });
    });

    it('fails explicitly when the worker URL is missing', () => {
      delete process.env.ORDER_RELEASE_WORKER_URL;
      expect(() => getOrderReleaseTaskConfiguration()).toThrow(
        'ORDER_RELEASE_WORKER_URL',
      );
    });
  });

  describe('OrderReleaseTaskQueue', () => {
    const releaseAt = new Date('2026-10-22T10:00:00.000Z');
    const createClient = () => ({
      queuePath: jest.fn().mockReturnValue('queue-path'),
      taskPath: jest.fn().mockReturnValue('task-path'),
      createTask: jest.fn().mockResolvedValue([{}]),
    });

    it('schedules one authenticated task at the release time', async () => {
      const client = createClient();

      await new OrderReleaseTaskQueue(client as any).scheduleRelease(
        'order-1',
        releaseAt,
      );

      expect(client.taskPath).toHaveBeenCalledWith(
        'cherry-test',
        'europe-west2',
        'order-fulfillment',
        'order-release-order-1',
      );
      expect(client.createTask).toHaveBeenCalledWith({
        parent: 'queue-path',
        task: expect.objectContaining({
          name: 'task-path',
          scheduleTime: { seconds: releaseAt.getTime() / 1000 },
          httpRequest: expect.objectContaining({
            url: 'https://cherry.example/api/internal/order-release/tasks',
            body: Buffer.from(JSON.stringify({ orderId: 'order-1' })).toString(
              'base64',
            ),
            oidcToken: {
              serviceAccountEmail: 'tasks@cherry-test.iam.gserviceaccount.com',
              audience: 'https://cherry.example',
            },
          }),
        }),
      });
    });

    it('treats an already scheduled task as success', async () => {
      const client = createClient();
      client.createTask.mockRejectedValue(
        Object.assign(new Error('exists'), { code: 6 }),
      );

      await expect(
        new OrderReleaseTaskQueue(client as any).scheduleRelease(
          'order-1',
          releaseAt,
        ),
      ).resolves.toBeUndefined();
    });

    it('surfaces other queue failures', async () => {
      const client = createClient();
      client.createTask.mockRejectedValue(new Error('unavailable'));

      await expect(
        new OrderReleaseTaskQueue(client as any).scheduleRelease(
          'order-1',
          releaseAt,
        ),
      ).rejects.toThrow('unavailable');
    });
  });

  describe('isAuthorizedOrderReleaseTask', () => {
    it('accepts only a verified token from the configured identity', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'tasks@cherry-test.iam.gserviceaccount.com',
          email_verified: true,
        }),
      });

      await expect(
        isAuthorizedOrderReleaseTask('Bearer signed-token'),
      ).resolves.toBe(true);
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'signed-token',
        audience: 'https://cherry.example',
      });
    });

    it('rejects another service account and a missing token', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'other@cherry-test.iam.gserviceaccount.com',
          email_verified: true,
        }),
      });

      await expect(
        isAuthorizedOrderReleaseTask('Bearer signed-token'),
      ).resolves.toBe(false);
      await expect(isAuthorizedOrderReleaseTask(undefined)).resolves.toBe(
        false,
      );
    });
  });

  describe('OrderReleaseService', () => {
    const releaseAt = new Date('2026-10-22T10:00:00.000Z');

    it('schedules the task, records it and returns when the hold ends', async () => {
      const repo = {
        recordDelivery: jest
          .fn()
          .mockResolvedValue({ releaseAt, releaseTaskPending: true }),
        markReleaseTaskEnqueued: jest.fn().mockResolvedValue(undefined),
      };
      const queue = { scheduleRelease: jest.fn().mockResolvedValue(undefined) };

      await expect(
        new OrderReleaseService(repo as any, queue as any).startHoldOnDelivery(
          'order-1',
        ),
      ).resolves.toEqual(releaseAt);

      expect(queue.scheduleRelease).toHaveBeenCalledWith('order-1', releaseAt);
      expect(repo.markReleaseTaskEnqueued).toHaveBeenCalledWith('order-1');
    });

    it('does not schedule again once a task exists', async () => {
      const repo = {
        recordDelivery: jest
          .fn()
          .mockResolvedValue({ releaseAt, releaseTaskPending: false }),
        markReleaseTaskEnqueued: jest.fn(),
      };
      const queue = { scheduleRelease: jest.fn() };

      await new OrderReleaseService(repo as any, queue as any).startHoldOnDelivery(
        'order-1',
      );

      expect(queue.scheduleRelease).not.toHaveBeenCalled();
    });

    it('keeps the hold and does not fail the webhook when scheduling fails', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const repo = {
        recordDelivery: jest
          .fn()
          .mockResolvedValue({ releaseAt, releaseTaskPending: true }),
        markReleaseTaskEnqueued: jest.fn(),
      };
      const queue = {
        scheduleRelease: jest.fn().mockRejectedValue(new Error('queue down')),
      };

      await expect(
        new OrderReleaseService(repo as any, queue as any).startHoldOnDelivery(
          'order-1',
        ),
      ).resolves.toEqual(releaseAt);
      expect(repo.markReleaseTaskEnqueued).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('reports no hold when the delivery cannot be recorded', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const repo = {
        recordDelivery: jest.fn().mockRejectedValue(new Error('firestore')),
      };
      const queue = { scheduleRelease: jest.fn() };

      await expect(
        new OrderReleaseService(repo as any, queue as any).startHoldOnDelivery(
          'order-1',
        ),
      ).resolves.toBeNull();
      expect(queue.scheduleRelease).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('reconcileOrderReleases', () => {
    const mockReconcile = jest.spyOn(
      OrderReleaseReconciliationService.prototype,
      'reconcile',
    );
    const summary = {
      scanned: 3,
      released: 2,
      alreadyReleased: 0,
      blocked: 1,
      tasksScheduled: 0,
      errors: 0,
    };

    const run = async (body: unknown) => {
      const res = createRes();
      await reconcileOrderReleases(
        { headers: { authorization: 'Bearer token' }, body } as any,
        res,
      );
      return res;
    };

    const authorize = (email: string) =>
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({ email, email_verified: true }),
      });

    beforeEach(() => {
      mockReconcile.mockReset();
      mockReconcile.mockResolvedValue(summary);
    });

    it('rejects an unauthorised caller', async () => {
      authorize('other@x.iam.gserviceaccount.com');

      expect((await run({})).statusCode).toBe(401);
      expect(mockReconcile).not.toHaveBeenCalled();
    });

    it('runs the reconciliation for the configured identity', async () => {
      authorize('tasks@cherry-test.iam.gserviceaccount.com');

      const res = await run({ limit: 50 });

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual(summary);
      expect(mockReconcile).toHaveBeenCalledWith(expect.any(Date), 50);
    });

    it('rejects an invalid limit', async () => {
      authorize('tasks@cherry-test.iam.gserviceaccount.com');

      expect((await run({ limit: 0 })).statusCode).toBe(400);
      expect(mockReconcile).not.toHaveBeenCalled();
    });

    it('fails so the caller retries when reconciliation breaks', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      authorize('tasks@cherry-test.iam.gserviceaccount.com');
      mockReconcile.mockRejectedValue(new Error('firestore down'));

      expect((await run({})).statusCode).toBe(500);
      errorSpy.mockRestore();
    });
  });

  describe('processOrderReleaseTask', () => {
    const mockRelease = jest.spyOn(
      jest.requireActual('../repositories/OrderRepository').OrderRepository
        .prototype,
      'releaseOrderForPayout',
    );

    const run = async (body: unknown) => {
      const res = createRes();
      await processOrderReleaseTask(
        { headers: { authorization: 'Bearer token' }, body } as any,
        res,
      );
      return res;
    };

    const authorize = (authorized: boolean) =>
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: authorized
            ? 'tasks@cherry-test.iam.gserviceaccount.com'
            : 'other@x.iam.gserviceaccount.com',
          email_verified: true,
        }),
      });

    beforeEach(() => {
      mockRelease.mockReset();
    });

    it('rejects an unauthorised caller without touching the order', async () => {
      authorize(false);
      const res = await run({ orderId: 'order-1' });

      expect(res.statusCode).toBe(401);
      expect(mockRelease).not.toHaveBeenCalled();
    });

    it('rejects an invalid order ID', async () => {
      authorize(true);
      const res = await run({ orderId: '../x' });

      expect(res.statusCode).toBe(400);
      expect(mockRelease).not.toHaveBeenCalled();
    });

    it('releases the order using the expiry trigger', async () => {
      authorize(true);
      mockRelease.mockResolvedValue({ status: 'released' });
      const res = await run({ orderId: 'order-1' });

      expect(res.statusCode).toBe(200);
      expect(mockRelease).toHaveBeenCalledWith('order-1', 'hold_expired');
    });

    it('acknowledges a blocked order so it is not retried', async () => {
      authorize(true);
      mockRelease.mockResolvedValue({ status: 'blocked', reason: 'dispute_open' });
      const res = await run({ orderId: 'order-1' });

      expect(res.statusCode).toBe(200);
    });

    it('asks Cloud Tasks to retry when the order is not yet due', async () => {
      authorize(true);
      mockRelease.mockResolvedValue({ status: 'blocked', reason: 'not_due' });
      const res = await run({ orderId: 'order-1' });

      expect(res.statusCode).toBe(503);
    });

    it('asks Cloud Tasks to retry on an unexpected failure', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      authorize(true);
      mockRelease.mockRejectedValue(new Error('firestore unavailable'));
      const res = await run({ orderId: 'order-1' });

      expect(res.statusCode).toBe(500);
      errorSpy.mockRestore();
    });
  });
});
