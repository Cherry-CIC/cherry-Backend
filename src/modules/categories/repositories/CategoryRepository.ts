import { firestore } from '../../../shared/config/firebaseConfig';
import { Category } from '../model/Category';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export class CategoryRepository {
    private db = firestore;
    private collectionName = 'categories';

    async getAll(): Promise<Category[]> {
        const snapshot = await this.db.collection(this.collectionName).get();
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
            } as Category;
        });
    }

    async getById(id: string): Promise<Category | null> {
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
        } as Category;
    }

    async create(category: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>): Promise<Category> {
        const docRef = await this.db.collection(this.collectionName).add({
            ...category,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        return {
            id: docRef.id,
            ...category,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    async update(id: string, category: Partial<Omit<Category, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Category | null> {
        const docRef = this.db.collection(this.collectionName).doc(id);
        const doc = await docRef.get();
        
        if (!doc.exists) {
            return null;
        }

        await docRef.update({
            ...category,
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
}