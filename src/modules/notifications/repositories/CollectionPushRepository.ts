import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import { COLLECTION_PUSH_JOBS, CollectionPushJob } from '../models/CollectionPushJob';

const LEASE_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const MAX_DEVICE_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const asDate = (value: any): Date | null => {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

export interface PushDevice { id: string; token: string; platform: 'ios' | 'android' }

export class CollectionPushRepository {
  constructor(private readonly db: FirebaseFirestore.Firestore = firestore) {}

  async dueIds(now: Date, limit: number): Promise<string[]> {
    // Single-field query: finished jobs have no nextAttemptAt field.
    const result = await this.db.collection(COLLECTION_PUSH_JOBS)
      .where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').limit(limit).get();
    return result.docs.map(doc => doc.id);
  }

  async claim(id: string, now: Date): Promise<CollectionPushJob | null> {
    const ref = this.db.collection(COLLECTION_PUSH_JOBS).doc(id);
    return this.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const data = snapshot.data();
      if (!data || !['pending', 'sending'].includes(data.status) ||
          !asDate(data.nextAttemptAt) || asDate(data.nextAttemptAt)!.getTime() > now.getTime()) return null;
      if (!asDate(data.expiresAt) || asDate(data.expiresAt)!.getTime() <= now.getTime() || data.attempts >= MAX_ATTEMPTS) {
        tx.update(ref, { status: 'failed', nextAttemptAt: FieldValue.delete(), leaseId: FieldValue.delete() });
        return null;
      }
      const leaseId = randomUUID();
      const nextAttemptAt = new Date(now.getTime() + LEASE_MS);
      tx.update(ref, { status: 'sending', leaseId, nextAttemptAt, attempts: data.attempts + 1 });
      return { ...data, eventId: id, leaseId, nextAttemptAt, attempts: data.attempts + 1,
        createdAt: asDate(data.createdAt)!, expiresAt: asDate(data.expiresAt)!,
        deliveredDeviceIds: data.deliveredDeviceIds ?? [], status: 'sending' } as CollectionPushJob;
    });
  }

  async eligible(job: CollectionPushJob, now: Date): Promise<{ deadline: Date | null } | null> {
    const [order, shipment] = await Promise.all([
      this.db.collection('orders').doc(job.orderId).get(),
      this.db.collection('shipments').doc(job.shipmentId).get(),
    ]);
    const data = order.data(); const parcel = shipment.data();
    const deadline = asDate(data?.collectionDeadline);
    if (!data || !parcel || data.userId !== job.userId || parcel.orderId !== job.orderId ||
        data.shipmentStatus !== 'awaiting_collection' || parcel.status !== 'awaiting_collection' ||
        (data.shipmentId && data.shipmentId !== job.shipmentId) ||
        data.deliveryType !== 'pickup_point' || String(data.shippingCarrier || parcel.carrier || '').toLowerCase() !== 'inpost_gb' ||
        data.paymentStatus !== 'succeeded' || ['cancelled', 'failed', 'expired'].includes(data.status) ||
        data.collectedAt || data.buyerConfirmedReceived || data.buyerDisputeStatus ||
        (deadline && deadline.getTime() <= now.getTime()) || job.expiresAt.getTime() <= now.getTime()) return null;
    return { deadline };
  }

  async devices(userId: string, now: Date): Promise<PushDevice[]> {
    const result = await this.db.collection('pushDevices').where('userId', '==', userId).get();
    return result.docs.flatMap(doc => {
      const value = doc.data();
      return this.validDevice(value, userId, now) ? [{ id: doc.id, token: value.token, platform: value.platform }] : [];
    });
  }

  private validDevice(value: any, userId: string, now: Date): boolean {
    const updated = asDate(value?.updatedAt);
    return value?.userId === userId && typeof value.token === 'string' && value.token.length > 0 &&
      ['ios', 'android'].includes(value.platform) && !!updated &&
      updated.getTime() > now.getTime() - MAX_DEVICE_AGE_MS;
  }

  // Renew ownership immediately before each send. Account switches and removed
  // tokens are rechecked rather than trusting the earlier devices query.
  async renewAndCheckDevice(job: CollectionPushJob, device: PushDevice, now: Date): Promise<boolean> {
    const ref = this.db.collection(COLLECTION_PUSH_JOBS).doc(job.eventId);
    const deviceRef = this.db.collection('pushDevices').doc(device.id);
    return this.db.runTransaction(async tx => {
      const [snapshot, registered] = await Promise.all([tx.get(ref), tx.get(deviceRef)]);
      const data = snapshot.data(); const value = registered.data();
      if (data?.status !== 'sending' || data.leaseId !== job.leaseId ||
          !asDate(data.nextAttemptAt) || asDate(data.nextAttemptAt)!.getTime() <= now.getTime() ||
          job.expiresAt.getTime() <= now.getTime() ||
          (data.deliveredDeviceIds ?? []).includes(device.id) || value?.token !== device.token ||
          !this.validDevice(value, job.userId, now)) return false;
      tx.update(ref, { nextAttemptAt: new Date(now.getTime() + LEASE_MS) });
      return true;
    });
  }

  async delivered(job: CollectionPushJob, deviceId: string): Promise<void> {
    await this.updateLeased(job, { deliveredDeviceIds: FieldValue.arrayUnion(deviceId) });
  }

  async removeInvalidDevice(job: CollectionPushJob, device: PushDevice): Promise<void> {
    const ref = this.db.collection('pushDevices').doc(device.id);
    await this.db.runTransaction(async tx => {
      const value = (await tx.get(ref)).data();
      if (value?.userId === job.userId && value?.token === device.token) tx.delete(ref);
    });
  }

  async finish(job: CollectionPushJob, status: 'complete' | 'cancelled' | 'failed'): Promise<void> {
    await this.updateLeased(job, { status, nextAttemptAt: FieldValue.delete(), leaseId: FieldValue.delete() });
  }

  async retry(job: CollectionPushJob, now: Date): Promise<void> {
    const delay = Math.min(15 * 60 * 1000, 30_000 * 2 ** Math.min(job.attempts - 1, 8));
    await this.updateLeased(job, { status: 'pending', nextAttemptAt: new Date(now.getTime() + delay), leaseId: FieldValue.delete() });
  }

  private async updateLeased(job: CollectionPushJob, update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>): Promise<void> {
    const ref = this.db.collection(COLLECTION_PUSH_JOBS).doc(job.eventId);
    await this.db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      if (data?.status === 'sending' && data.leaseId === job.leaseId) tx.update(ref, update);
    });
  }
}
