jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }));
import { CollectionPushDispatcher } from '../services/CollectionPushDispatcher';
import { CollectionPushRepository } from '../repositories/CollectionPushRepository';
import { newCollectionPushJob } from '../models/CollectionPushJob';

describe('collection push dispatcher', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const deviceA = { id: 'a', token: 'token-a', platform: 'android' };
  const deviceB = { id: 'b', token: 'token-b', platform: 'ios' };
  let repository: Record<string, jest.Mock>;
  let send: jest.Mock;
  let job: ReturnType<typeof newCollectionPushJob>;
  let worker: CollectionPushDispatcher;

  beforeEach(() => {
    job = { ...newCollectionPushJob('parcel', 'order', 'buyer', now), status: 'sending', attempts: 1, leaseId: 'lease' };
    repository = {
      dueIds: jest.fn().mockResolvedValue([job.eventId]),
      claim: jest.fn().mockResolvedValue(job),
      eligible: jest.fn().mockResolvedValue({ deadline: new Date(now.getTime() + 72 * 3600 * 1000) }),
      devices: jest.fn().mockResolvedValue([deviceA, deviceB]),
      renewAndCheckDevice: jest.fn().mockResolvedValue(true),
      delivered: jest.fn().mockImplementation(async (_job, deviceId) => { job.deliveredDeviceIds.push(deviceId); }),
      removeInvalidDevice: jest.fn().mockResolvedValue(undefined),
      finish: jest.fn().mockResolvedValue(undefined), retry: jest.fn().mockResolvedValue(undefined),
    };
    send = jest.fn().mockResolvedValue('message-id');
    worker = new CollectionPushDispatcher(repository as unknown as CollectionPushRepository, send, () => now, () => true);
  });

  it('does not query or send unless explicitly enabled', async () => {
    const disabled = new CollectionPushDispatcher(repository as unknown as CollectionPushRepository, send, () => now, () => false);
    expect(await disabled.runBatch()).toEqual({ enabled: false, claimed: 0 });
    expect(repository.dueIds).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('defaults to disabled without the exact enabled environment value', async () => {
    const previous = process.env.COLLECTION_PUSH_ENABLED;
    try {
      process.env.COLLECTION_PUSH_ENABLED = 'TRUE';
      const disabled = new CollectionPushDispatcher(repository as unknown as CollectionPushRepository, send, () => now);
      expect((await disabled.runBatch()).enabled).toBe(false);
      expect(send).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.COLLECTION_PUSH_ENABLED;
      else process.env.COLLECTION_PUSH_ENABLED = previous;
    }
  });

  it('sends generic messages with stable collapse identifiers and tap routing data', async () => {
    expect(await worker.runBatch()).toEqual({ enabled: true, claimed: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({
      token: 'token-a', notification: { title: 'Ready to collect' },
      data: { type: 'ready_to_collect', orderId: 'order', userId: 'buyer', eventId: job.eventId },
      android: { collapseKey: job.eventId, notification: { tag: job.eventId }, ttl: 3600 * 1000 },
      apns: { headers: { 'apns-collapse-id': job.eventId, 'apns-push-type': 'alert' } },
    });
    expect(job.eventId.length).toBe(64);
    expect(repository.delivered).toHaveBeenCalledWith(job, 'a');
    expect(repository.delivered).toHaveBeenCalledWith(job, 'b');
    expect(repository.finish).toHaveBeenCalledWith(job, 'complete');
  });

  it('retries a transient provider failure without sending again to a successful device', async () => {
    send.mockResolvedValueOnce('message-a').mockRejectedValueOnce(new Error('provider unavailable'));
    await worker.runBatch();
    expect(repository.retry).toHaveBeenCalledWith(job, now);
    expect(job.deliveredDeviceIds).toEqual(['a']);
    send.mockClear();
    await worker.runBatch();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].token).toBe('token-b');
    expect(repository.finish).toHaveBeenCalledWith(job, 'complete');
  });

  it('waits for registration when there are no devices', async () => {
    repository.devices.mockResolvedValue([]);
    await worker.runBatch();
    expect(send).not.toHaveBeenCalled();
    expect(repository.retry).toHaveBeenCalledWith(job, now);
    expect(repository.finish).not.toHaveBeenCalled();
  });

  it('allows readiness without inventing a missing collection deadline', async () => {
    repository.eligible.mockResolvedValue({ deadline: null });
    await worker.runBatch();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].data).not.toHaveProperty('collectionDeadline');
  });

  it('cancels an obsolete job before querying devices or sending', async () => {
    repository.eligible.mockResolvedValue(null);
    await worker.runBatch();
    expect(repository.devices).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(job, 'cancelled');
  });

  it('rechecks collection status immediately before each send', async () => {
    repository.eligible.mockResolvedValueOnce({ deadline: null }).mockResolvedValueOnce({ deadline: null }).mockResolvedValueOnce(null);
    await worker.runBatch();
    expect(send).toHaveBeenCalledTimes(1);
    expect(repository.finish).toHaveBeenCalledWith(job, 'cancelled');
  });

  it('does not send a token that changed owner or lost its lease after selection', async () => {
    repository.renewAndCheckDevice.mockResolvedValue(false);
    await worker.runBatch();
    expect(send).not.toHaveBeenCalled();
    expect(repository.retry).toHaveBeenCalledWith(job, now);
    expect(repository.finish).not.toHaveBeenCalled();
  });

  it('removes rejected registration tokens without retrying them', async () => {
    send.mockRejectedValue({ code: 'messaging/registration-token-not-registered' });
    await worker.runBatch();
    expect(repository.removeInvalidDevice).toHaveBeenCalledWith(job, deviceA);
    expect(repository.removeInvalidDevice).toHaveBeenCalledWith(job, deviceB);
    expect(repository.retry).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(job, 'complete');
  });

  it('bounds provider expiry to the remaining collection time', async () => {
    repository.eligible.mockResolvedValue({ deadline: new Date(now.getTime() + 15_000) });
    await worker.runBatch();
    expect(send.mock.calls[0][0].android.ttl).toBe(15_000);
    expect(send.mock.calls[0][0].apns.headers['apns-expiration']).toBe(String(Math.floor(now.getTime() / 1000) + 15));
  });

  it('never sends when the deadline passes during eligibility reads', async () => {
    repository.eligible.mockResolvedValue({ deadline: now });
    await worker.runBatch();
    expect(send).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(job, 'cancelled');
  });

  it('skips jobs claimed by another worker', async () => {
    repository.claim.mockResolvedValue(null);
    expect((await worker.runBatch()).claimed).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves a failed receipt for retry with the same event identifier', async () => {
    repository.devices.mockResolvedValue([deviceA]);
    repository.delivered.mockRejectedValueOnce(new Error('database unavailable'));
    await worker.runBatch();
    expect(repository.retry).toHaveBeenCalledWith(job, now);
    // A crash after FCM accepts a message but before this receipt can cause a
    // repeat. Stable collapse IDs mitigate it; they cannot ensure exactly once.
    await worker.runBatch();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].data.eventId).toBe(send.mock.calls[1][0].data.eventId);
  });

  it('continues with other jobs if processing and its retry write fail', async () => {
    repository.dueIds.mockResolvedValue(['one', 'two']);
    repository.devices.mockRejectedValueOnce(new Error('read failed'));
    repository.retry.mockRejectedValueOnce(new Error('write failed'));
    await expect(worker.runBatch()).resolves.toEqual({ enabled: true, claimed: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([[Infinity, 20], [-3, 1], [200, 100]])('bounds requested batch size %s', async (requested, expected) => {
    await worker.runBatch(requested);
    expect(repository.dueIds).toHaveBeenCalledWith(now, expected);
  });
});
