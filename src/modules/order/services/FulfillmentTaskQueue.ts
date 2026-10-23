import { CloudTasksClient } from '@google-cloud/tasks';

export interface FulfillmentTaskConfiguration {
  projectId: string;
  location: string;
  queue: string;
  workerUrl: string;
  audience: string;
  serviceAccountEmail: string;
}

export const getFulfillmentTaskConfiguration =
  (): FulfillmentTaskConfiguration => {
    const projectId =
      process.env.CLOUD_TASKS_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID;
    const location = process.env.CLOUD_TASKS_LOCATION;
    const queue = process.env.CLOUD_TASKS_QUEUE;
    const workerUrl = process.env.FULFILLMENT_WORKER_URL;
    const audience = process.env.FULFILLMENT_WORKER_AUDIENCE;
    const serviceAccountEmail = process.env.FULFILLMENT_WORKER_SERVICE_ACCOUNT;
    const missingValues = [
      ['CLOUD_TASKS_PROJECT_ID or FIREBASE_PROJECT_ID', projectId],
      ['CLOUD_TASKS_LOCATION', location],
      ['CLOUD_TASKS_QUEUE', queue],
      ['FULFILLMENT_WORKER_URL', workerUrl],
      ['FULFILLMENT_WORKER_AUDIENCE', audience],
      ['FULFILLMENT_WORKER_SERVICE_ACCOUNT', serviceAccountEmail],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missingValues.length) {
      throw new Error(
        `Cloud Tasks fulfillment is not configured: ${missingValues.join(', ')}`,
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

export class FulfillmentTaskQueue {
  constructor(private readonly client = new CloudTasksClient()) {}

  async enqueue(orderId: string): Promise<void> {
    const configuration = getFulfillmentTaskConfiguration();
    const parent = this.client.queuePath(
      configuration.projectId,
      configuration.location,
      configuration.queue,
    );

    await this.client.createTask({
      parent,
      task: {
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
  }
}
