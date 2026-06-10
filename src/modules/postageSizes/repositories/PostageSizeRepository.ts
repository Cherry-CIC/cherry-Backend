import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import { PostageSize } from '../model/PostageSize';

const POSTAGE_SIZE_ORDER: Record<string, number> = {
  small: 1,
  medium: 2,
  large: 3,
};

export class PostageSizeRepository {
  private collectionName = 'postage_sizes';

  async getAll(): Promise<PostageSize[]> {
    const snapshot = await firestore.collection(this.collectionName).get();

    return snapshot.docs
      .map((doc) => this.mapToPostageSize(doc.id, doc.data()))
      .sort((left, right) => {
        const leftOrder = POSTAGE_SIZE_ORDER[left.size] ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = POSTAGE_SIZE_ORDER[right.size] ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.size.localeCompare(right.size);
      });
  }

  private mapToPostageSize(id: string, data: any): PostageSize {
    const size = String(data.size || id || '').toLowerCase();

    return {
      id,
      type: String(data.type || data.carrier || 'inpost').toLowerCase(),
      size,
      description: data.description || '',
      createdAt: this.toDate(data.createdAt),
      updatedAt: this.toDate(data.updatedAt),
    };
  }

  private toDate(value: any): Date | undefined {
    if (!value) {
      return undefined;
    }

    if (value instanceof Timestamp || typeof value.toDate === 'function') {
      return value.toDate();
    }

    return new Date(value);
  }
}
