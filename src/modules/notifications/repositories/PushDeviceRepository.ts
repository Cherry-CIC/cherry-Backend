import { createHash } from 'crypto';
import { firestore } from '../../../shared/config/firebaseConfig';

export class PushDeviceLimitError extends Error {}

export class PushDeviceRepository {
  constructor(private readonly db = firestore) {}

  private reference(token: string) {
    return this.db.collection('pushDevices').doc(createHash('sha256').update(token).digest('hex'));
  }

  async register(userId: string, token: string, platform: 'ios' | 'android'): Promise<void> {
    const ref = this.reference(token);
    await this.db.runTransaction(async tx => {
      const current = await tx.get(ref);
      const now = new Date();
      if (current.data()?.userId !== userId) {
        const owned = await tx.get(this.db.collection('pushDevices').where('userId', '==', userId).limit(20));
        const stale = owned.docs.filter(doc => {
          const stored = doc.data().updatedAt;
          const date = stored?.toDate ? stored.toDate() : stored;
          return !(date instanceof Date) || !Number.isFinite(date.getTime()) ||
            date.getTime() <= now.getTime() - 90 * 24 * 60 * 60 * 1000;
        });
        if (owned.size - stale.length >= 20) throw new PushDeviceLimitError('Device limit reached');
        // Expired registrations must not permanently prevent a new phone from
        // joining. The transaction also protects concurrent token refreshes.
        for (const doc of stale) tx.delete(doc.ref);
      }
      // One owner per token. Refreshes and account switches replace the record.
      tx.set(ref, { userId, token, platform, updatedAt: now });
    });
  }

  async remove(userId: string, token: string): Promise<void> {
    const ref = this.reference(token);
    await this.db.runTransaction(async tx => {
      const current = await tx.get(ref);
      // A delayed logout must not remove another account's new registration.
      if (current.data()?.userId === userId) tx.delete(ref);
    });
  }
}
