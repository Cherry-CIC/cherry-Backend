import express from 'express';
import request from 'supertest';

const mockRegister = jest.fn();
const mockRemove = jest.fn();
const mockDispatch = jest.fn();
jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {},
  admin: { auth: () => ({ verifyIdToken: async (token: string) => {
    if (token === 'buyer') return { uid: 'buyer-1' };
    if (token === 'admin') return { uid: 'admin-1', admin: true };
    throw new Error('Invalid token');
  } }) },
}));
jest.mock('../repositories/PushDeviceRepository', () => {
  const actual = jest.requireActual('../repositories/PushDeviceRepository');
  return { ...actual, PushDeviceRepository: jest.fn().mockImplementation(() => ({ register: mockRegister, remove: mockRemove })) };
});
jest.mock('../services/CollectionPushDispatcher', () => ({
  CollectionPushDispatcher: jest.fn().mockImplementation(() => ({ runBatch: mockDispatch })),
}));
jest.mock('../services/EmailService', () => ({ EmailService: jest.fn() }));

import routes from '../routes/notificationRoutes';
import { PushDeviceLimitError } from '../repositories/PushDeviceRepository';
const app = express();
app.use(express.json());
app.use('/notifications', routes);

describe('notification device and dispatch routes', () => {
  const originalFlag = process.env.COLLECTION_PUSH_ENABLED;
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.COLLECTION_PUSH_ENABLED = 'true';
    // resetAllMocks clears constructor implementations as well.
    const { PushDeviceRepository } = require('../repositories/PushDeviceRepository');
    PushDeviceRepository.mockImplementation(() => ({ register: mockRegister, remove: mockRemove }));
    const { CollectionPushDispatcher } = require('../services/CollectionPushDispatcher');
    CollectionPushDispatcher.mockImplementation(() => ({ runBatch: mockDispatch }));
  });
  afterAll(() => {
    if (originalFlag === undefined) delete process.env.COLLECTION_PUSH_ENABLED;
    else process.env.COLLECTION_PUSH_ENABLED = originalFlag;
  });

  it.each(['post', 'delete'] as const)('requires authentication for %s device requests', async method => {
    expect((await request(app)[method]('/notifications/devices').send({ token: 'secret', platform: 'ios' })).status).toBe(401);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
  it('takes ownership only from the verified token and never echoes the device token', async () => {
    const response = await request(app).post('/notifications/devices').set('Authorization', 'Bearer buyer')
      .send({ token: 'private-device-token', platform: 'android', userId: 'someone-else' });
    expect(response.status).toBe(200);
    expect(mockRegister).toHaveBeenCalledWith('buyer-1', 'private-device-token', 'android');
    expect(JSON.stringify(response.body)).not.toContain('private-device-token');
  });
  it.each(['', 'bad token', '\nsecret', 'a'.repeat(4097), 42, null])('rejects invalid device token %p', async token => {
    const response = await request(app).post('/notifications/devices').set('Authorization', 'Bearer buyer').send({ token, platform: 'ios' });
    expect(response.status).toBe(400);
    expect(mockRegister).not.toHaveBeenCalled();
  });
  it('rejects unsupported platforms', async () => {
    expect((await request(app).post('/notifications/devices').set('Authorization', 'Bearer buyer').send({ token: 'token', platform: 'web' })).status).toBe(400);
  });
  it('defaults registration off while leaving owner cleanup available', async () => {
    delete process.env.COLLECTION_PUSH_ENABLED;
    expect((await request(app).post('/notifications/devices').set('Authorization', 'Bearer buyer').send({ token: 'token', platform: 'ios' })).status).toBe(503);
    expect((await request(app).delete('/notifications/devices').set('Authorization', 'Bearer buyer').send({ token: 'token', userId: 'someone-else' })).status).toBe(200);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith('buyer-1', 'token');
  });
  it('reports the device limit without provider details', async () => {
    mockRegister.mockRejectedValue(new PushDeviceLimitError('private-details'));
    const response = await request(app).post('/notifications/devices').set('Authorization', 'Bearer buyer').send({ token: 'secret', platform: 'ios' });
    expect(response.status).toBe(429);
    expect(JSON.stringify(response.body)).not.toContain('private-details');
  });
  it('does not expose provider errors containing registration tokens', async () => {
    mockRegister.mockRejectedValue(new Error('private-device-token'));
    const response = await request(app).post('/notifications/devices').set('Authorization', 'Bearer buyer').send({ token: 'private-device-token', platform: 'ios' });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('private-device-token');
  });
  it('requires administrator authentication for dispatch', async () => {
    expect((await request(app).post('/notifications/dispatch-collection')).status).toBe(401);
    expect((await request(app).post('/notifications/dispatch-collection').set('Authorization', 'Bearer buyer')).status).toBe(403);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
  it('allows an administrator to dispatch a bounded batch', async () => {
    mockDispatch.mockResolvedValue({ enabled: true, claimed: 2 });
    const response = await request(app).post('/notifications/dispatch-collection').set('Authorization', 'Bearer admin').send({ limit: 10 });
    expect(response.status).toBe(200);
    expect(mockDispatch).toHaveBeenCalledWith(10);
  });
  it.each([0, 101, 1.5, '20'])('rejects invalid dispatch limit %p', async limit => {
    expect((await request(app).post('/notifications/dispatch-collection').set('Authorization', 'Bearer admin').send({ limit })).status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
