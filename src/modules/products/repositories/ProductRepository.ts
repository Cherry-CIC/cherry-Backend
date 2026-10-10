import {
  assertOwner,
  assertSafetyVerified,
  assertUnreserved,
  requireVersion,
  ListingSafetyError,
  listingEditingEnabled,
} from '../../../shared/utils/listingSafety';
import { parseListingEdit } from '../validators/productValidator';
import type { UpdateProductData } from '../services/ProductService';
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
  constructor(private readonly db: FirebaseFirestore.Firestore = firestore) {}
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
    const ref = this.db.collection(this.collectionName).doc();
    const stored = {
      ...product,
      editVersion: 0,
      editSafetyVerified: true,
      hasSales: false,
      hasBeenEdited: false,
    };
    await this.db.runTransaction(async (tx) => {
      const deleting = await tx.get(
        this.db.collection('account_deletions').doc(product.userId),
      );
      if (deleting.exists)
        throw new ListingSafetyError(
          409,
          'ACCOUNT_DELETION_PENDING',
          'Account deletion is in progress.',
        );
      tx.create(ref, {
        ...stored,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return {
      ...stored,
      id: ref.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async update(
    id: string,
    input: UpdateProductData,
    uid: string,
  ): Promise<Product> {
    if (!listingEditingEnabled())
      throw new ListingSafetyError(
        503,
        'LISTING_EDIT_DISABLED',
        'Listing editing is not available yet.',
      );
    const { expectedEditVersion, ...changes } = parseListingEdit(input);
    const ref = this.db.collection(this.collectionName).doc(id);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists)
        throw new ListingSafetyError(
          404,
          'LISTING_NOT_FOUND',
          'Listing not found.',
        );
      const data = doc.data()!;
      assertOwner(data, uid);
      assertSafetyVerified(data);
      assertUnreserved(data);
      const version = requireVersion(data);
      if (version !== expectedEditVersion)
        throw new ListingSafetyError(
          409,
          'LISTING_VERSION_CONFLICT',
          'This listing has changed. Reload it before saving.',
        );
      if (
        !['active', 'unlisted'].includes(data.status) ||
        !Number.isSafeInteger(data.number) ||
        data.number <= 0
      ) {
        throw new ListingSafetyError(
          409,
          'LISTING_NOT_EDITABLE',
          'This listing cannot be edited in its current state.',
        );
      }
      const orders = await tx.get(
        this.db.collection('orders').where('productId', '==', id).limit(1),
      );
      if (data.hasSales === true || !orders.empty)
        throw new ListingSafetyError(
          409,
          'LISTING_HAS_SALES',
          'Listings with a purchase history cannot be edited.',
        );
      if (changes.categoryId) {
        const category = await tx.get(
          this.db.collection('categories').doc(changes.categoryId),
        );
        if (!category.exists)
          throw new ListingSafetyError(
            400,
            'LISTING_INVALID_CATEGORY',
            'Choose an existing category.',
          );
      }
      const updates = {
        ...changes,
        hasBeenEdited: true,
        editVersion: version + 1,
        updatedAt: new Date(),
      };
      tx.update(ref, updates);
      return this.mapToProduct(id, { ...data, ...updates });
    });
  }

  async changeAvailability(
    id: string,
    uid: string,
    status: 'active' | 'unlisted' | 'delete',
  ): Promise<Product | null> {
    const ref = this.db.collection(this.collectionName).doc(id);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists)
        throw new ListingSafetyError(
          404,
          'LISTING_NOT_FOUND',
          'Listing not found.',
        );
      const data = doc.data()!;
      assertOwner(data, uid);
      assertSafetyVerified(data);
      assertUnreserved(data);
      const version = requireVersion(data);
      const orders = await tx.get(
        this.db.collection('orders').where('productId', '==', id).limit(1),
      );
      if (status === 'delete' && (data.hasSales === true || !orders.empty))
        throw new ListingSafetyError(
          409,
          'LISTING_HAS_SALES',
          'Purchased listings must be retained.',
        );
      if (status !== 'delete' && (data.status === 'sold' || data.number <= 0))
        throw new ListingSafetyError(
          409,
          'LISTING_NOT_AVAILABLE',
          'This listing has no available stock.',
        );
      if (status === 'delete') {
        tx.delete(ref);
        return null;
      }
      if (data.status === status) return this.mapToProduct(id, data);
      const updates = {
        status,
        editVersion: version + 1,
        updatedAt: new Date(),
      };
      tx.update(ref, updates);
      return this.mapToProduct(id, { ...data, ...updates });
    });
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
