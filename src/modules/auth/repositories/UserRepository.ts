import { firestore } from '../../../shared/config/firebaseConfig';
import { User } from '../model/User';
import { Timestamp, FieldValue, WriteBatch } from 'firebase-admin/firestore';

export class UserRepository {
  private db = firestore;
  private collectionName = 'users';

  private mapUser(doc: FirebaseFirestore.DocumentSnapshot): User {
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

  private cleanUser(
    user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
  ): Omit<User, 'id' | 'createdAt' | 'updatedAt'> {
    return Object.fromEntries(
      Object.entries(user).filter(([, value]) => value !== undefined),
    ) as Omit<User, 'id' | 'createdAt' | 'updatedAt'>;
  }

  async getAll(): Promise<User[]> {
    const snapshot = await this.db.collection(this.collectionName).get();
    return snapshot.docs.map((doc) => this.mapUser(doc));
  }

  async getById(id: string): Promise<User | null> {
    const querySnap = await this.db
      .collection(this.collectionName)
      .where('id', '==', id)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return null;
    }

    return this.mapUser(querySnap.docs[0]);
  }

  async getByFirebaseUid(firebaseUid: string): Promise<User | null> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('id', '==', firebaseUid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return this.mapUser(snapshot.docs[0]);
  }

  async getByEmail(email: string): Promise<User | null> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return this.mapUser(snapshot.docs[0]);
  }

  async findOrCreateByFirebaseUid(
    user: Omit<User, 'id' | 'createdAt' | 'updatedAt'> & { firebaseUid: string },
  ): Promise<{ user: User; created: boolean }> {
    const existingUser = await this.getByFirebaseUid(user.firebaseUid);
    if (existingUser) {
      return { user: existingUser, created: false };
    }

    const { firebaseUid, ...rest } = user;
    const cleanUser = this.cleanUser({ id: firebaseUid, ...rest } as any);
    const docRef = this.db.collection(this.collectionName).doc(firebaseUid);

    return this.db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      if (doc.exists) {
        return { user: this.mapUser(doc), created: false };
      }

      transaction.create(docRef, {
        ...cleanUser,
        id: firebaseUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        user: {
          id: docRef.id,
          ...cleanUser,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as User,
        created: true,
      };
    });
  }

  async create(
    user: Omit<User, 'createdAt' | 'updatedAt'>,
  ): Promise<User> {
    const cleanUser = this.cleanUser(user as any);
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
    } as User;
  }

  async update(
    id: string,
    user: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<User | null> {
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

  async deleteAccountData(firebaseUid: string): Promise<{
    deletedUserProfiles: number;
    deletedProducts: number;
    deletedOrders: number;
    deletedShipments: number;
  }> {
    const userProfilesSnapshot = await this.db
      .collection(this.collectionName)
      .where('id', '==', firebaseUid)
      .get();

    const productsSnapshot = await this.db
      .collection('products')
      .where('userId', '==', firebaseUid)
      .get();

    const ordersSnapshot = await this.db
      .collection('orders')
      .where('userId', '==', firebaseUid)
      .get();

    const orderIds = ordersSnapshot.docs.map((doc) => doc.id);

    const shipmentSnapshots = await Promise.all(
      orderIds.map((orderId) =>
        this.db.collection('shipments').where('orderId', '==', orderId).get(),
      ),
    );

    const shipmentDocs = shipmentSnapshots.flatMap((snapshot) => snapshot.docs);

    const uniqueShipmentDocs = Array.from(
      new Map(shipmentDocs.map((doc) => [doc.id, doc])).values(),
    );

    const docsToDelete = [
      ...userProfilesSnapshot.docs,
      ...productsSnapshot.docs,
      ...ordersSnapshot.docs,
      ...uniqueShipmentDocs,
    ];

    if (docsToDelete.length > 450) {
      throw new Error(
        'Account cleanup exceeds the Firestore atomic batch limit.',
      );
    }

    const batch: WriteBatch = this.db.batch();
    docsToDelete.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    return {
      deletedUserProfiles: userProfilesSnapshot.size,
      deletedProducts: productsSnapshot.size,
      deletedOrders: ordersSnapshot.size,
      deletedShipments: uniqueShipmentDocs.length,
    };
  }
}