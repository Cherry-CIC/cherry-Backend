const mockVerifyIdToken = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import { isAuthorizedFulfillmentTask } from '../services/FulfillmentTaskAuth';

describe('isAuthorizedFulfillmentTask', () => {
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
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = environment;
  });

  it('accepts only a verified token from the configured worker identity', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'tasks@cherry-test.iam.gserviceaccount.com',
        email_verified: true,
      }),
    });

    await expect(
      isAuthorizedFulfillmentTask('Bearer signed-worker-token'),
    ).resolves.toBe(true);
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-worker-token',
      audience: 'https://cherry.example',
    });
  });

  it('rejects a validly signed token for a different service account', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'other@cherry-test.iam.gserviceaccount.com',
        email_verified: true,
      }),
    });

    await expect(
      isAuthorizedFulfillmentTask('Bearer signed-worker-token'),
    ).resolves.toBe(false);
  });

  it('surfaces token verification failures', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

    await expect(
      isAuthorizedFulfillmentTask('Bearer invalid-token'),
    ).rejects.toThrow('Invalid token');
  });
});
