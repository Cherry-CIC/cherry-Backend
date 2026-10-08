import { firestore } from '../../../shared/config/firebaseConfig';
import { Product, ProductStatus } from '../model/Product';
import { FieldPath, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { assertNoUnresolvedCheckouts } from '../../payment/CheckoutContextRepository';
import {
  assertAccountsActive,
  filterActiveOwners,
  isAccountRestricted,
} from '../../account-deletion/access';

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
  constructor(private readonly db: FirebaseFirestore.Firestore = firestore) {}
  private collectionName = 'products';

  private async visible(query: FirebaseFirestore.Query): Promise<Product[]> {
    const snapshot = await query.get();
    return filterActiveOwners(
      snapshot.docs.map((doc) => this.mapToProduct(doc.id, doc.data()!)),
      (product) => product.userId,
      this.db,
    );
  }

  async getAll(): Promise<Product[]> {
    return this.visible(this.db.collection(this.collectionName));
  }

  async getById(id: string): Promise<Product | null> {
    const doc = await this.db.collection(this.collectionName).doc(id).get();
    if (!doc.exists) return null;
    const product = this.mapToProduct(doc.id, doc.data()!);
    if (!product.userId || (await isAccountRestricted(product.userId, this.db)))
      return null;
    return product;
  }

  /** Server-only fulfilment lookup. The caller must first verify a succeeded payment. */
  async getForPaidOrder(id: string): Promise<Product | null> {
    const doc = await this.db.collection(this.collectionName).doc(id).get();
    return doc.exists ? this.mapToProduct(doc.id, doc.data()!) : null;
  }

  async create(product: Product): Promise<Product> {
    const docRef = this.db.collection(this.collectionName).doc();
    await this.db.runTransaction(async (transaction) => {
      await assertAccountsActive(transaction, [product.userId], this.db);
      transaction.create(docRef, {
        ...product,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return {
      ...product,
      id: docRef.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async update(
    id: string,
    product: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Product | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    const exists = await this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return false;
      const owner = doc.data()!.userId;
      if (product.userId !== undefined && product.userId !== owner)
        throw new Error('Product ownership cannot be changed');
      await assertAccountsActive(transaction, [owner], this.db);
      const financialFields: (keyof typeof product)[] = [
        'price',
        'number',
        'postageSize',
        'charityId',
        'donation',
        'status',
      ];
      if (
        financialFields.some(
          (key) => product[key] !== undefined && product[key] !== doc.get(key),
        )
      ) {
        await assertNoUnresolvedCheckouts(transaction, id, this.db);
      }
      transaction.update(docRef, {
        ...product,
        userId: owner,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    return exists ? this.getById(id) : null;
  }

  async delete(id: string): Promise<boolean> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return false;
      await assertAccountsActive(transaction, [doc.data()!.userId], this.db);
      await assertNoUnresolvedCheckouts(transaction, id, this.db);
      transaction.delete(docRef);
      return true;
    });
  }

  async getProductsByCategory(categoryId: string): Promise<Product[]> {
    return this.visible(
      this.db
        .collection(this.collectionName)
        .where('categoryId', '==', categoryId),
    );
  }

  async getByUserId(userId: string): Promise<Product[]> {
    return this.visible(
      this.db.collection(this.collectionName).where('userId', '==', userId),
    );
  }

  async getProductsByCharity(charityId: string): Promise<Product[]> {
    return this.visible(
      this.db
        .collection(this.collectionName)
        .where('charityId', '==', charityId),
    );
  }

  async getPageByFilters(
    filters: ProductListFilters = {},
    limit: number,
    cursor?: ProductQueryCursor,
  ): Promise<ProductQueryPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Invalid product page size');
    }
    if (
      filters.userId &&
      (await isAccountRestricted(filters.userId, this.db))
    ) {
      return { items: [], hasMore: false };
    }
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

    // Deleting owners may still have source documents until cleanup runs.
    // Scan past those documents before deciding the visible page boundary.
    const visible: Product[] = [];
    let scanned = 0;
    while (visible.length <= limit) {
      if (scanned >= 5000) throw new Error('Product scan limit exceeded');
      const count = Math.min(scanned === 0 ? limit + 1 : 100, 5000 - scanned);
      const snapshot = await query.limit(count).get();
      scanned += snapshot.docs.length;
      visible.push(
        ...(await filterActiveOwners(
          snapshot.docs.map((doc) => this.mapToProduct(doc.id, doc.data())),
          (product) => product.userId,
          this.db,
        )),
      );
      if (visible.length > limit || snapshot.docs.length < count) break;
      query = query.startAfter(snapshot.docs[snapshot.docs.length - 1]);
    }

    return { items: visible.slice(0, limit), hasMore: visible.length > limit };
  }

  async adjustLikes(id: string, delta: number): Promise<Product | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    const exists = await this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return false;
      const data = doc.data()!;
      await assertAccountsActive(transaction, [data.userId], this.db);
      const currentLikes = typeof data.likes === 'number' ? data.likes : 0;
      transaction.update(docRef, {
        likes: Math.max(0, currentLikes + delta),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    return exists ? this.getById(id) : null;
  }

  private mapToProduct(
    id: string,
    data: FirebaseFirestore.DocumentData,
  ): Product {
    return {
      ...data,
      id,
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
