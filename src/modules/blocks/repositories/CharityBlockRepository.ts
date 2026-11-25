import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';

export interface CharityBlock {
  id: string;
  blockerId: string;
  blockedCharityId: string;
  createdAt: Date;
}

/** Persists per-viewer charity blocks using deterministic document IDs. */
export class CharityBlockRepository {
  constructor(private readonly db = firestore) {}

  private id(blockerId: string, blockedCharityId: string): string {
    return Buffer.from(JSON.stringify([blockerId, blockedCharityId])).toString(
      'base64url',
    );
  }

  async block(
    blockerId: string,
    blockedCharityId: string,
  ): Promise<CharityBlock> {
    const ref = this.db
      .collection('charity_blocks')
      .doc(this.id(blockerId, blockedCharityId));
    await ref.set(
      { blockerId, blockedCharityId, createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return {
      id: ref.id,
      blockerId,
      blockedCharityId,
      createdAt: new Date(),
    };
  }

  async unblock(blockerId: string, blockedCharityId: string): Promise<void> {
    await this.db
      .collection('charity_blocks')
      .doc(this.id(blockerId, blockedCharityId))
      .delete();
  }

  async isBlocked(
    blockerId: string,
    blockedCharityId: string,
  ): Promise<boolean> {
    const doc = await this.db
      .collection('charity_blocks')
      .doc(this.id(blockerId, blockedCharityId))
      .get();
    return doc.exists;
  }

  async listBlockedCharities(blockerId: string): Promise<CharityBlock[]> {
    const snapshot = await this.db
      .collection('charity_blocks')
      .where('blockerId', '==', blockerId)
      .get();
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        blockerId: data.blockerId,
        blockedCharityId: data.blockedCharityId,
        createdAt:
          data.createdAt instanceof Timestamp
            ? data.createdAt.toDate()
            : new Date(data.createdAt || 0),
      };
    });
  }

  async getBlockedCharityIds(blockerId: string): Promise<Set<string>> {
    const blocks = await this.listBlockedCharities(blockerId);
    return new Set(blocks.map((block) => block.blockedCharityId));
  }
}
