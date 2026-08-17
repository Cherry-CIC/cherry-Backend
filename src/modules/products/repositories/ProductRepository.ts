import { firestore } from '../../../shared/config/firebaseConfig';
import { Product, ProductStatus } from '../model/Product';
import { FieldPath, Timestamp, FieldValue } from 'firebase-admin/firestore';

export interface ProductListFilters {
  userId?: string;
  categoryId?: string;
  charityId?: string;
  size?: string;
  quality?: string;
  status?: ProductStatus;
  minPrice?: number;
  maxPrice?: number;
}

export interface ProductQueryCursor {
  createdAt: Date;
  id: string;
}

export interface ProductQueryPage {
  items: Product[];
  hasMore: boolean;
}

export class ProductRepository {
  private db = firestore;
  private collectionName = 'products';

  async getAll(): Promise<Product[]> {
    const snapshot = await this.db.collection(this.collectionName).get();
    return snapshot.docs.map((doc) => this.mapToProduct(doc.id, doc.data()));
  }

  async getById(id: string): Promise<Product | null> {
    const doc = await this.db.collection(this.collectionName).doc(id).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data()!;
    return this.mapToProduct(doc.id, data);
  }

  async create(product: Product): Promise<Product> {
    const docRef = await this.db.collection(this.collectionName).add({
      ...product,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      id: docRef.id,
      ...product,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async update(
    id: string,
    product: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Product | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    await docRef.update({
      ...product,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return false;
    }

    await docRef.delete();
    return true;
  }

  async getProductsByCategory(categoryId: string): Promise<Product[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('categoryId', '==', categoryId)
      .get();

    return snapshot.docs.map((doc) => this.mapToProduct(doc.id, doc.data()));
  }

  async getByUserId(userId: string): Promise<Product[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('userId', '==', userId)
      .get();

    return snapshot.docs.map((doc) => this.mapToProduct(doc.id, doc.data()));
  }

  async getProductsByCharity(charityId: string): Promise<Product[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('charityId', '==', charityId)
      .get();

    return snapshot.docs.map((doc) => this.mapToProduct(doc.id, doc.data()));
  }

  async getPageByFilters(
    filters: ProductListFilters = {},
    limit: number,
    cursor?: ProductQueryCursor,
  ): Promise<ProductQueryPage> {
    let query: FirebaseFirestore.Query = this.db.collection(
      this.collectionName,
    );

    if (filters.userId) {
      query = query.where('userId', '==', filters.userId);
    }

    if (filters.categoryId) {
      query = query.where('categoryId', '==', filters.categoryId);
    }

    if (filters.charityId) {
      query = query.where('charityId', '==', filters.charityId);
    }

    if (filters.size) {
      query = query.where('size', '==', filters.size);
    }

    if (filters.quality) {
      query = query.where('quality', '==', filters.quality);
    }

    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }

    if (typeof filters.minPrice === 'number') {
      query = query.where('price', '>=', filters.minPrice);
    }

    if (typeof filters.maxPrice === 'number') {
      query = query.where('price', '<=', filters.maxPrice);
    }

    query = query
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (cursor) {
      query = query.startAfter(cursor.createdAt, cursor.id);
    }

    const snapshot = await query.limit(limit + 1).get();
    const docs = snapshot.docs.slice(0, limit);

    return {
      items: docs.map((doc) => this.mapToProduct(doc.id, doc.data())),
      hasMore: snapshot.docs.length > limit,
    };
  }
  /**
   * Adjust the likes count by a signed delta.
   * Guarantees the likes never go below zero.
   */
  async adjustLikes(id: string, delta: number): Promise<Product | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as Product;
    const currentLikes = typeof data.likes === 'number' ? data.likes : 0;
    const newLikes = Math.max(0, currentLikes + delta);

    await docRef.update({
      likes: newLikes,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return this.getById(id);
  }

  private mapToProduct(
    id: string,
    data: FirebaseFirestore.DocumentData,
  ): Product {
    return {
      id,
      ...data,
      status: this.resolveProductStatus(data),
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate()
          : data.updatedAt,
    } as Product;
  }

  private resolveProductStatus(
    data: FirebaseFirestore.DocumentData,
  ): ProductStatus {
    if (['active', 'unlisted', 'sold'].includes(data.status)) {
      return data.status;
    }

    return typeof data.number === 'number' && data.number > 0
      ? 'active'
      : 'sold';
  }
}
