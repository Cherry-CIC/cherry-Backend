import { firestore } from '../../../shared/config/firebaseConfig';
import { User } from '../model/User';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export class UserRepository {
    private db = firestore;
    private collectionName = 'users';

    private mapUser(doc: FirebaseFirestore.DocumentSnapshot): User {
        const data = doc.data()!;

        return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt,
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : data.updatedAt,
        } as User;
    }

    private cleanUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Omit<User, 'id' | 'createdAt' | 'updatedAt'> {
        return Object.fromEntries(
            Object.entries(user).filter(([, value]) => value !== undefined)
        ) as Omit<User, 'id' | 'createdAt' | 'updatedAt'>;
    }

    async getAll(): Promise<User[]> {
        const snapshot = await this.db.collection(this.collectionName).get();
        return snapshot.docs.map(doc => this.mapUser(doc));
    }

    async getById(id: string): Promise<User | null> {
        const doc = await this.db.collection(this.collectionName).doc(id).get();
        if (!doc.exists) {
            return null;
        }
        return this.mapUser(doc);
    }

    async getByFirebaseUid(firebaseUid: string): Promise<User | null> {
        const snapshot = await this.db.collection(this.collectionName).where('firebaseUid', '==', firebaseUid).limit(1).get();
        if (snapshot.empty) {
            return null;
        }
        return this.mapUser(snapshot.docs[0]);
    }

    async getByEmail(email: string): Promise<User | null> {
        const snapshot = await this.db.collection(this.collectionName).where('email', '==', email).limit(1).get();
        if (snapshot.empty) {
            return null;
        }
        return this.mapUser(snapshot.docs[0]);
    }

    async findOrCreateByFirebaseUid(
        user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<{ user: User; created: boolean }> {
        const existingUser = await this.getByFirebaseUid(user.firebaseUid);
        if (existingUser) {
            return {
                user: existingUser,
                created: false,
            };
        }

        const cleanUser = this.cleanUser(user);
        const docRef = this.db.collection(this.collectionName).doc(user.firebaseUid);

        return this.db.runTransaction(async transaction => {
            const doc = await transaction.get(docRef);

            if (doc.exists) {
                return {
                    user: this.mapUser(doc),
                    created: false,
                };
            }

            transaction.create(docRef, {
                ...cleanUser,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return {
                user: {
                    id: docRef.id,
                    ...cleanUser,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                created: true,
            };
        });
    }

    async create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
        const cleanUser = this.cleanUser(user);
        
        const docRef = await this.db.collection(this.collectionName).add({
            ...cleanUser,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        return {
            id: docRef.id,
            ...cleanUser,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    async update(id: string, user: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>): Promise<User | null> {
        const docRef = this.db.collection(this.collectionName).doc(id);
        const doc = await docRef.get();
        
        if (!doc.exists) {
            return null;
        }

        await docRef.update({
            ...user,
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
