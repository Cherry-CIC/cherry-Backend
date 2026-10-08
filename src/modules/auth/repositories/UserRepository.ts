import { firestore } from '../../../shared/config/firebaseConfig';
import { User } from '../model/User';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

import {
  assertAccountsActive,
  filterActiveOwners,
  isAccountRestricted,
} from '../../account-deletion/access';

export class UserRepository {
  private db = firestore;
  private collectionName = 'users';

  async getAll(): Promise<User[]> {
    const snapshot = await this.db.collection(this.collectionName).get();
    return filterActiveOwners(
      snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt:
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate()
              : data.createdAt,
          updatedAt:
            data.updatedAt instanceof Timestamp
              ? data.updatedAt.toDate()
              : data.updatedAt,
        } as User;
      }),
      (user) => user.id,
    );
  }

  async getById(id: string): Promise<User | null> {
    if (await isAccountRestricted(id)) return null;
    const querySnap = await this.db
      .collection(this.collectionName)
      .where('id', '==', id)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return null;
    }

    const doc = querySnap.docs[0];
    const data = doc.data()!;

    return {
      id: doc.id,
      ...data,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate()
          : data.updatedAt,
    } as User;
  }

  async getByFirebaseUid(firebaseUid: string): Promise<User | null> {
    if (await isAccountRestricted(firebaseUid)) return null;
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('id', '==', firebaseUid)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    return {
      id: doc.id,
      ...data,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate()
          : data.updatedAt,
    } as User;
  }

  async getByEmail(email: string): Promise<User | null> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('email', '==', email)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    if (!data.id || (await isAccountRestricted(data.id))) return null;

    return {
      id: doc.id,
      ...data,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate()
          : data.updatedAt,
    } as User;
  }

  async create(user: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User> {
    // Filter out undefined values to prevent Firestore errors
    const cleanUser = Object.fromEntries(
      Object.entries(user).filter(([, value]) => value !== undefined),
    );

    const docRef = this.db.collection(this.collectionName).doc();
    await this.db.runTransaction(async (transaction) => {
      await assertAccountsActive(transaction, [user.id!]);
      transaction.create(docRef, {
        ...cleanUser,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      id: docRef.id,
      ...user,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async update(
    id: string,
    user: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<User | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    const uid = await this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (!doc.exists) return null;
      const owner = doc.data()!.id;
      await assertAccountsActive(transaction, [owner]);
      // Runtime sanitisation also prevents callers from changing the stored UID.
      const { id: ignoredId, ...updates } = user as Partial<User>;
      transaction.update(docRef, {
        ...updates,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return owner as string;
    });
    return uid ? this.getById(uid) : null;
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

  // Account cleanup belongs to the durable deletion workflow, never a single batch.
}
