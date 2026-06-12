import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import { PostageSize } from '../model/PostageSize';

export class PostageSizeRepository {
  private readonly db = firestore;
  private readonly collectionName = 'postage_sizes';

  async getAll(): Promise<PostageSize[]> {
    const snapshot = await this.db.collection(this.collectionName).get();

    return snapshot.docs.map((doc) => this.mapDocument(doc.id, doc.data()));
  }

  async getById(id: string): Promise<PostageSize | null> {
    const doc = await this.db.collection(this.collectionName).doc(id).get();

    if (!doc.exists) {
      return null;
    }

    return this.mapDocument(doc.id, doc.data()!);
  }

  async update(
    id: string,
    postageSize: Partial<
      Omit<PostageSize, 'id' | 'createdAt' | 'updatedAt'>
    >,
  ): Promise<PostageSize | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    await docRef.update({
      ...postageSize,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const updatedDoc = await docRef.get();
    return this.mapDocument(updatedDoc.id, updatedDoc.data()!);
  }

  private mapDocument(id: string, data: any): PostageSize {
    return {
      id,
      ...data,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate()
          : data.updatedAt,
    } as PostageSize;
  }
}
