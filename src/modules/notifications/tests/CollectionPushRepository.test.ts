const deleted = Symbol('deleted');
jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => deleted, arrayUnion: (...values: string[]) => ({ union: values }) },
}));

import { CollectionPushRepository } from '../repositories/CollectionPushRepository';
import { CollectionPushJob, newCollectionPushJob } from '../models/CollectionPushJob';

// Serial transactions exercise competing worker claims and stale lease holders.
// Reads after writes are rejected to match Firestore's transaction constraint.
function database(documents: Record<string, any>) {
  let queue = Promise.resolve();
  const ref = (path: string) => ({ path, get: async () => snapshot(path) });
  const snapshot = (path: string) => ({ id: path.split('/').pop(), data: () => documents[path] });
  const db = {
    collection: (name: string) => {
      const filters: Array<(value: any) => boolean> = [];
      let sortKey: string | undefined;
      let limit = Infinity;
      const query = {
        doc: (id: string) => ref(name + '/' + id),
        where: (key: string, op: string, value: any) => {
          filters.push(data => op === '==' ? data[key] === value : data[key] <= value);
          return query;
        },
        orderBy: (key: string) => { sortKey = key; return query; },
        limit: (count: number) => { limit = count; return query; },
        get: async () => ({ docs: Object.keys(documents)
          .filter(path => path.startsWith(name + '/') && filters.every(filter => filter(documents[path])))
          .sort((a, b) => sortKey ? documents[a][sortKey] - documents[b][sortKey] : 0)
          .slice(0, limit).map(snapshot) }),
      };
      return query;
    },
    runTransaction: <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const run = queue.then(async () => {
        const writes: Array<() => void> = [];
        const result = await fn({
          get: async ({ path }: any) => {
            if (writes.length) throw new Error('Read after write');
            return snapshot(path);
          },
          update: ({ path }: any, changes: any) => writes.push(() => {
            if (!documents[path]) throw new Error('Missing document');
            for (const [key, value] of Object.entries(changes) as Array<[string, any]>) {
              if (value === deleted) delete documents[path][key];
              else if (value?.union) documents[path][key] = [...new Set([...(documents[path][key] || []), ...value.union])];
              else documents[path][key] = value;
            }
          }),
          delete: ({ path }: any) => writes.push(() => { delete documents[path]; }),
        });
        writes.forEach(write => write());
        return result;
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return db as any;
}

describe('collection push persistence and leases', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  let docs: Record<string, any>;
  let repo: CollectionPushRepository;
  let pending: CollectionPushJob;
  let jobPath: string;
  const device = { id: 'device', token: 'test-token', platform: 'android' as const };

  beforeEach(() => {
    pending = newCollectionPushJob('parcel', 'order', 'buyer', now);
    jobPath = 'collectionPushJobs/' + pending.eventId;
    docs = {
      [jobPath]: { ...pending },
      'orders/order': { userId: 'buyer', shipmentId: 'parcel', shipmentStatus: 'awaiting_collection',
        deliveryType: 'pickup_point', shippingCarrier: 'inpost_gb', paymentStatus: 'succeeded', status: 'shipped',
        collectionDeadline: new Date(now.getTime() + 1000 * 3600) },
      'shipments/parcel': { orderId: 'order', status: 'awaiting_collection', carrier: 'InPost' },
      'pushDevices/device': { userId: 'buyer', token: device.token, platform: device.platform, updatedAt: now },
    };
    repo = new CollectionPushRepository(database(docs));
  });

  it('lets only one competing worker claim a due job', async () => {
    const claims = await Promise.all([repo.claim(pending.eventId, now), repo.claim(pending.eventId, now)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(docs[jobPath].attempts).toBe(1);
    expect(await repo.dueIds(now, 20)).toEqual([]);
  });

  it('recovers an expired lease and prevents the old holder changing receipts or state', async () => {
    const oldJob = (await repo.claim(pending.eventId, now))!;
    const later = new Date(now.getTime() + 4 * 60 * 1000);
    const newJob = (await repo.claim(pending.eventId, later))!;
    expect(newJob.leaseId).not.toBe(oldJob.leaseId);
    expect(await repo.renewAndCheckDevice(oldJob, device, later)).toBe(false);
    await repo.delivered(oldJob, device.id);
    await repo.finish(oldJob, 'complete');
    expect(docs[jobPath].deliveredDeviceIds).toEqual([]);
    expect(docs[jobPath].status).toBe('sending');
    await repo.delivered(newJob, device.id);
    expect(docs[jobPath].deliveredDeviceIds).toEqual([device.id]);
  });

  it('keeps successful device receipts through retry and stops scheduling completed jobs', async () => {
    const job = (await repo.claim(pending.eventId, now))!;
    await repo.delivered(job, device.id);
    await repo.retry(job, now);
    expect(docs[jobPath].status).toBe('pending');
    expect(await repo.claim(pending.eventId, now)).toBeNull();
    const retried = (await repo.claim(pending.eventId, new Date(now.getTime() + 31_000)))!;
    expect(retried.deliveredDeviceIds).toEqual([device.id]);
    expect(await repo.renewAndCheckDevice(retried, device, new Date(now.getTime() + 31_000))).toBe(false);
    await repo.finish(retried, 'complete');
    expect(await repo.dueIds(new Date(now.getTime() + 24 * 3600 * 1000), 20)).toEqual([]);
  });

  it('rejects expired leases even if no replacement worker has claimed them', async () => {
    const job = (await repo.claim(pending.eventId, now))!;
    expect(await repo.renewAndCheckDevice(job, device, new Date(now.getTime() + 4 * 60 * 1000))).toBe(false);
  });

  it.each(['complete', 'cancelled', 'failed'])('does not claim a %s job', async status => {
    docs[jobPath].status = status;
    expect(await repo.claim(pending.eventId, now)).toBeNull();
  });

  it.each([{ expiresAt: now }, { attempts: 20 }])('stops retrying exhausted jobs %j', async change => {
    Object.assign(docs[jobPath], change);
    expect(await repo.claim(pending.eventId, now)).toBeNull();
    expect(docs[jobPath].status).toBe('failed');
    expect(docs[jobPath].nextAttemptAt).toBeUndefined();
  });

  it('rechecks ownership after the device query and never deletes a transferred token', async () => {
    const job = (await repo.claim(pending.eventId, now))!;
    expect(await repo.devices('buyer', now)).toEqual([device]);
    docs['pushDevices/device'].userId = 'other-buyer';
    expect(await repo.renewAndCheckDevice(job, device, now)).toBe(false);
    await repo.removeInvalidDevice(job, device);
    expect(docs['pushDevices/device'].userId).toBe('other-buyer');
  });

  it('removes invalid tokens only while they still belong to this buyer', async () => {
    await repo.removeInvalidDevice(pending, device);
    expect(docs['pushDevices/device']).toBeUndefined();
  });

  it('filters stale devices and other buyers', async () => {
    docs['pushDevices/stale'] = { ...docs['pushDevices/device'], updatedAt: new Date('2025-01-01') };
    docs['pushDevices/other'] = { ...docs['pushDevices/device'], userId: 'other' };
    expect(await repo.devices('buyer', now)).toEqual([device]);
  });

  it.each([
    { shipmentStatus: 'collected' }, { shipmentStatus: 'returned' }, { shipmentStatus: 'returning' },
    { shipmentStatus: 'cancelled' }, { shipmentStatus: 'exception' }, { paymentStatus: 'refunded' },
    { paymentStatus: 'failed' }, { status: 'cancelled' }, { status: 'expired' }, { status: 'failed' },
    { collectedAt: now }, { collectionDeadline: now }, { buyerConfirmedReceived: true },
    { buyerDisputeStatus: 'raised' }, { userId: 'another' }, { shipmentId: 'replacement-parcel' },
    { shippingCarrier: 'another' }, { deliveryType: 'home' },
  ])('suppresses obsolete or ineligible orders %j', async changes => {
    Object.assign(docs['orders/order'], changes);
    expect(await repo.eligible(pending, now)).toBeNull();
  });

  it('rejects a missing or mismatched shipment', async () => {
    docs['shipments/parcel'].orderId = 'other-order';
    expect(await repo.eligible(pending, now)).toBeNull();
    delete docs['shipments/parcel'];
    expect(await repo.eligible(pending, now)).toBeNull();
  });

  it('uses canonical carrier, with a canonical shipment fallback when absent', async () => {
    expect(await repo.eligible(pending, now)).not.toBeNull();
    delete docs['orders/order'].shippingCarrier;
    docs['shipments/parcel'].carrier = 'inpost_gb';
    expect(await repo.eligible(pending, now)).not.toBeNull();
  });

  it('allows a timely ready notification without inventing missing carrier evidence', async () => {
    delete docs['orders/order'].collectionDeadline;
    expect(await repo.eligible(pending, now)).toEqual({ deadline: null });
    expect(await repo.eligible(pending, pending.expiresAt)).toBeNull();
  });
});
