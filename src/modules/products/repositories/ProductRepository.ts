import { firestore } from '../../../shared/config/firebaseConfig';
import { Product } from "../model/Product";
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export class ProductRepository {
    private db = firestore;
    private collectionName = 'products';

    async getAll(): Promise<Product[]> {
        const snapshot = await this.db.collection(this.collectionName).get();
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
            } as Product;
        });
    }

    async getById(id: string): Promise<Product | null> {
        const doc = await this.db.collection(this.collectionName).doc(id).get();
        if (!doc.exists) {
            return null;
        }
        const data = doc.data()!;
        return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
        } as Product;
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

    async update(id: string, product: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Product | null> {
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
        
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
            } as Product;
        });
    }

    async getByUserId(userId: string): Promise<Product[]> {
        const snapshot = await this.db
            .collection(this.collectionName)
            .where('userId', '==', userId)
            .get();
        
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
            } as Product;
        });
    }

    async getProductsByCharity(charityId: string): Promise<Product[]> {
        const snapshot = await this.db
            .collection(this.collectionName)
            .where('charityId', '==', charityId)
            .get();
        
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
            } as Product;
        });
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

  /**
   * Add user to likedBy array and increment like count atomically.
   * Uses transaction to ensure idempotency - only increments if user not already in array.
   */
  async addLike(id: string, userId: string): Promise<Product | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);

    try {
      await this.db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        
        if (!doc.exists) {
          throw new Error('Product not found');
        }

        const data = doc.data() as Product;
        const likedBy = data.likedBy || [];
        
        // Only update if user hasn't already liked
        if (!likedBy.includes(userId)) {
          transaction.update(docRef, {
            likedBy: FieldValue.arrayUnion(userId),
            likes: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      return this.getById(id);
    } catch (error) {
      if (error instanceof Error && error.message === 'Product not found') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Remove user from likedBy array and decrement like count atomically.
   * Uses transaction to ensure idempotency - only decrements if user is in array.
   * Prevents likes from going negative.
   */
  async removeLike(id: string, userId: string): Promise<Product | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);

    try {
      await this.db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        
        if (!doc.exists) {
          throw new Error('Product not found');
        }

        const data = doc.data() as Product;
        const likedBy = data.likedBy || [];
        const currentLikes = typeof data.likes === 'number' ? data.likes : 0;
        
        // Only update if user is actually in likedBy array
        if (likedBy.includes(userId)) {
          transaction.update(docRef, {
            likedBy: FieldValue.arrayRemove(userId),
            likes: Math.max(0, currentLikes - 1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          // Remove from array anyway in case of inconsistency, but don't decrement
          transaction.update(docRef, {
            likedBy: FieldValue.arrayRemove(userId),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      return this.getById(id);
    } catch (error) {
      if (error instanceof Error && error.message === 'Product not found') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all products liked by a specific user with pagination support.
   * @param userId - User ID to filter by
   * @param limit - Maximum number of results to return (default: 20)
   * @param startAfter - Optional document ID to start after for cursor-based pagination
   */
  async getProductsLikedByUser(
    userId: string, 
    limit: number = 20, 
    startAfter?: string
  ): Promise<Product[]> {
    let query = this.db
      .collection(this.collectionName)
      .where('likedBy', 'array-contains', userId)
      .orderBy('updatedAt', 'desc')
      .limit(limit);
    
    // If startAfter is provided, get that document and start after it
    if (startAfter) {
      const startDoc = await this.db.collection(this.collectionName).doc(startAfter).get();
      if (startDoc.exists) {
        query = query.startAfter(startDoc);
      }
    }

    const snapshot = await query.get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
        updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
      } as Product;
    });
  }
}
