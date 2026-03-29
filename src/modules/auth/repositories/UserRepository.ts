import { firestore } from '../../../shared/config/firebaseConfig';
import { User } from '../model/User';
import { Timestamp, FieldValue, WriteBatch } from 'firebase-admin/firestore';

export class UserRepository {
  private db = firestore;
  private collectionName = 'users';

  async getAll(): Promise<User[]> {
    const snapshot = await this.db.collection(this.collectionName).get();
    return snapshot.docs.map((doc) => {
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
    });
  }

  async getById(id: string): Promise<User | null> {
    const querySnap = await this.db
      .collection(this.collectionName)
      .where("id", "==", id)
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

  async create(
    user: Omit<User, 'createdAt' | 'updatedAt'>,
  ): Promise<User> {
    // Filter out undefined values to prevent Firestore errors
    const cleanUser = Object.fromEntries(
      Object.entries(user).filter(([, value]) => value !== undefined),
    );

    const docRef = await this.db.collection(this.collectionName).add({
      ...cleanUser,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
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