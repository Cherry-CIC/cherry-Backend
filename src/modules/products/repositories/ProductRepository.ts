import { firestore } from '../../../shared/config/firebaseConfig';
import { Product } from "../model/Product";
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export class ProductRepository {
    private db = firestore;
    private collectionName = 'products';

    async getAll(): Promise<Product[]> {
        const snapshot = await this.db.collection(this.collectionName)
            .where('visibilityStatus', '!=', 'inactive')
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

    async getById(id: string, includeInactive: boolean = false): Promise<Product | null> {
        const doc = await this.db.collection(this.collectionName).doc(id).get();
        if (!doc.exists) {
            return null;
        }
        const data = doc.data()!;
        if (!includeInactive && data.visibilityStatus === 'inactive') {
            return null;
        }
        return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
        } as Product;
    }

    async create(product: Product): Promise<Product> {
        const visibilityStatus = product.visibilityStatus || 'active';
        const docRef = await this.db.collection(this.collectionName).add({
            ...product,
            visibilityStatus,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            id: docRef.id,
            ...product,
            visibilityStatus,
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

    async deactivateProductsByUserId(userId: string): Promise<void> {
        const snapshot = await this.db
            .collection(this.collectionName)
            .where('userId', '==', userId)
            .get();

        const docs = snapshot.docs;
        const batchLimit = 500;
        
        for (let i = 0; i < docs.length; i += batchLimit) {
            const batch = this.db.batch();
            const chunk = docs.slice(i, i + batchLimit);
            chunk.forEach(doc => {
                batch.update(doc.ref, {
                    visibilityStatus: 'inactive',
                    updatedAt: FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
        }
    }

    async getProductsByCategory(categoryId: string): Promise<Product[]> {
        const snapshot = await this.db
            .collection(this.collectionName)
            .where('categoryId', '==', categoryId)
            .where('visibilityStatus', '==', 'active')
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
            .where('visibilityStatus', '==', 'active')
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
}
