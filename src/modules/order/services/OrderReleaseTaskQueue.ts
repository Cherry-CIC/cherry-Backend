import { CloudTasksClient } from '@google-cloud/tasks';

export interface OrderReleaseTaskConfiguration {
  projectId: string;
  location: string;
  queue: string;
  workerUrl: string;
  audience: string;
  serviceAccountEmail: string;
}

// Reuses the Cloud Tasks queue, OIDC audience and service account provisioned
// for fulfilment (PR #64). Dedicated ORDER_RELEASE_* values take precedence.
export const getOrderReleaseTaskConfiguration =
  (): OrderReleaseTaskConfiguration => {
    const projectId =
      process.env.CLOUD_TASKS_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID;
    const location = process.env.CLOUD_TASKS_LOCATION;
    const queue =
      process.env.ORDER_RELEASE_TASKS_QUEUE || process.env.CLOUD_TASKS_QUEUE;
    const workerUrl = process.env.ORDER_RELEASE_WORKER_URL;
    const audience =
      process.env.ORDER_RELEASE_WORKER_AUDIENCE ||
      process.env.FULFILLMENT_WORKER_AUDIENCE;
    const serviceAccountEmail =
      process.env.ORDER_RELEASE_WORKER_SERVICE_ACCOUNT ||
      process.env.FULFILLMENT_WORKER_SERVICE_ACCOUNT;
    const missingValues = [
      ['CLOUD_TASKS_PROJECT_ID or FIREBASE_PROJECT_ID', projectId],
      ['CLOUD_TASKS_LOCATION', location],
      ['ORDER_RELEASE_TASKS_QUEUE or CLOUD_TASKS_QUEUE', queue],
      ['ORDER_RELEASE_WORKER_URL', workerUrl],
      [
        'ORDER_RELEASE_WORKER_AUDIENCE or FULFILLMENT_WORKER_AUDIENCE',
        audience,
      ],
      [
        'ORDER_RELEASE_WORKER_SERVICE_ACCOUNT or FULFILLMENT_WORKER_SERVICE_ACCOUNT',
        serviceAccountEmail,
      ],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missingValues.length) {
      throw new Error(
        `Order release tasks are not configured: ${missingValues.join(', ')}`,
      );
    }

    return {
      projectId: projectId!,
      location: location!,
      queue: queue!,
      workerUrl: workerUrl!,
      audience: audience!,
      serviceAccountEmail: serviceAccountEmail!,
    };
  };

const ALREADY_EXISTS = 6;

export class OrderReleaseTaskQueue {
  private client?: CloudTasksClient;

  constructor(client?: CloudTasksClient) {
    this.client = client;
  }

  private getClient(): CloudTasksClient {
    this.client ??= new CloudTasksClient();
    return this.client;
  }

  // The deterministic task name makes scheduling idempotent per order.
  async scheduleRelease(orderId: string, releaseAt: Date): Promise<void> {
    const configuration = getOrderReleaseTaskConfiguration();
    const client = this.getClient();
    const parent = client.queuePath(
      configuration.projectId,
      configuration.location,
      configuration.queue,
    );

    try {
      await client.createTask({
        parent,
        task: {
          name: client.taskPath(
            configuration.projectId,
            configuration.location,
            configuration.queue,
            `order-release-${orderId}`,
          ),
          scheduleTime: { seconds: Math.floor(releaseAt.getTime() / 1000) },
          httpRequest: {
            httpMethod: 'POST',
            url: configuration.workerUrl,
            headers: {
              'Content-Type': 'application/json',
            },
            body: Buffer.from(JSON.stringify({ orderId })).toString('base64'),
            oidcToken: {
              serviceAccountEmail: configuration.serviceAccountEmail,
              audience: configuration.audience,
            },
          },
          dispatchDeadline: { seconds: 540 },
        },
      });
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) {
        return;
      }
      throw err;
    }
  }
}
