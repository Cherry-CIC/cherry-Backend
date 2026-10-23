import {
  FulfillmentTaskQueue,
  getFulfillmentTaskConfiguration,
} from '../services/FulfillmentTaskQueue';

describe('FulfillmentTaskQueue', () => {
  const environment = { ...process.env };

  beforeEach(() => {
    process.env.CLOUD_TASKS_PROJECT_ID = 'cherry-test';
    process.env.CLOUD_TASKS_LOCATION = 'europe-west2';
    process.env.CLOUD_TASKS_QUEUE = 'order-fulfillment';
    process.env.FULFILLMENT_WORKER_URL =
      'https://cherry.example/api/internal/fulfillment/tasks';
    process.env.FULFILLMENT_WORKER_AUDIENCE = 'https://cherry.example';
    process.env.FULFILLMENT_WORKER_SERVICE_ACCOUNT =
      'tasks@cherry-test.iam.gserviceaccount.com';
  });

  afterAll(() => {
    process.env = environment;
  });

  it('enqueues an authenticated worker task for the order', async () => {
    const client = {
      queuePath: jest.fn().mockReturnValue('queue-path'),
      createTask: jest.fn().mockResolvedValue([{}]),
    };
    const queue = new FulfillmentTaskQueue(client as any);

    await queue.enqueue('order-1');

    expect(client.queuePath).toHaveBeenCalledWith(
      'cherry-test',
      'europe-west2',
      'order-fulfillment',
    );
    expect(client.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: 'queue-path',
        task: expect.objectContaining({
          httpRequest: expect.objectContaining({
            url: 'https://cherry.example/api/internal/fulfillment/tasks',
            body: Buffer.from(JSON.stringify({ orderId: 'order-1' })).toString(
              'base64',
            ),
            oidcToken: {
              serviceAccountEmail: 'tasks@cherry-test.iam.gserviceaccount.com',
              audience: 'https://cherry.example',
            },
          }),
          dispatchDeadline: { seconds: 540 },
        }),
      }),
    );
  });

  it('fails explicitly when required queue configuration is missing', () => {
    delete process.env.CLOUD_TASKS_LOCATION;

    expect(() => getFulfillmentTaskConfiguration()).toThrow(
      'CLOUD_TASKS_LOCATION',
    );
  });
});
