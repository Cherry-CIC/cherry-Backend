import { createHash } from 'crypto';
import { DocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';

const deviceLimit = 20;
const activePeriodMs = 90 * 24 * 60 * 60 * 1000;

export type PushDevice = { id: string; token: string };
export class PushDeviceLimitError extends Error {}
export class PushProfileMissingError extends Error {}

function isActiveDevice(doc: DocumentSnapshot, userId: string, now: Date): boolean {
  const data = doc.data();
  if (!data || data.userId !== userId || typeof data.token !== 'string') return false;
  const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt;
  return updatedAt instanceof Date && updatedAt.getTime() > now.getTime() - activePeriodMs;
}

export class PushDeviceRepository {
  constructor(private readonly db = firestore) {}

  private reference(token: string) {
    return this.db.collection('pushDevices').doc(createHash('sha256').update(token).digest('hex'));
  }

  private devicesFor(userId: string) {
    return this.db.collection('pushDevices').where('userId', '==', userId).limit(deviceLimit);
  }

  async register(userId: string, token: string, platform: 'ios' | 'android'): Promise<void> {
    const ref = this.reference(token);
    await this.db.runTransaction(async tx => {
      const current = await tx.get(ref);
      // Account deletion removes the profile before clearing owned device records.
      const profile = await tx.get(this.db.collection('users').where('id', '==', userId).limit(1));
      if (profile.empty) throw new PushProfileMissingError();
      const now = new Date();
      if (current.data()?.userId !== userId) {
        const owned = await tx.get(this.devicesFor(userId));
        const expired = owned.docs.filter(doc => !isActiveDevice(doc, userId, now));
        if (owned.size - expired.length >= deviceLimit) throw new PushDeviceLimitError();
        for (const doc of expired) tx.delete(doc.ref);
      }
      // A token belongs to the account currently signed in on this device.
      tx.set(ref, { userId, token, platform, updatedAt: now });
    });
  }

  async remove(userId: string, token: string): Promise<void> {
    const ref = this.reference(token);
    await this.db.runTransaction(async tx => {
      const current = await tx.get(ref);
      // A delayed logout must preserve the new owner's registration.
      if (current.data()?.userId === userId) tx.delete(ref);
    });
  }

  async listActive(userId: string): Promise<PushDevice[]> {
    const owned = await this.devicesFor(userId).get();
    const now = new Date();
    return owned.docs
      .filter(doc => isActiveDevice(doc, userId, now))
      .map(doc => ({ id: doc.id, token: doc.get('token') }));
  }

  async isCurrent(userId: string, device: PushDevice): Promise<boolean> {
    const current = await this.reference(device.token).get();
    return current.id === device.id && isActiveDevice(current, userId, new Date());
  }
}
