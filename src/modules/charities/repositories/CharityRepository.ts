import { firestore } from '../../../shared/config/firebaseConfig';
import { Charity } from '../model/Charity';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export class CharityRepository {
    private db = firestore;
    private collectionName = 'charities';

    async getAll(): Promise<Charity[]> {
        const snapshot = await this.db.collection(this.collectionName).get();
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
            } as Charity;
        });
    }

    async getById(id: string): Promise<Charity | null> {
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
        } as Charity;
    }

    async create(charity: Omit<Charity, 'id' | 'createdAt' | 'updatedAt'>): Promise<Charity> {
        const docRef = await this.db.collection(this.collectionName).add({
            ...charity,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        return {
            id: docRef.id,
            ...charity,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    async update(id: string, charity: Partial<Omit<Charity, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Charity | null> {
        const docRef = this.db.collection(this.collectionName).doc(id);
        const doc = await docRef.get();
        
        if (!doc.exists) {
            return null;
        }

        await docRef.update({
            ...charity,
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