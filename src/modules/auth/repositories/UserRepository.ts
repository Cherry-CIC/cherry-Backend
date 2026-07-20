import { firestore } from '../../../shared/config/firebaseConfig';
import { User } from '../model/User';
import { Timestamp, FieldValue, WriteBatch } from 'firebase-admin/firestore';

const DELETED_USER_MARKER = 'deleted_user';
const DELETED_EMAIL_MARKER = 'deleted@anonymous.invalid';
const REDACTED_VALUE = 'REDACTED';
const FIRESTORE_BATCH_LIMIT = 450;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

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
    deletedUnsoldProducts: number;
    anonymisedProducts: number;
    anonymisedOrders: number;
    anonymisedShipments: number;
    deletedLikes: number;
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

    const likesSnapshot = await this.db
      .collection('user_likes')
      .where('userId', '==', firebaseUid)
      .get();

    const orderIds = ordersSnapshot.docs.map((doc) => doc.id);
    const soldProductDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    const unsoldProductDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

    for (const productDoc of productsSnapshot.docs) {
      const relatedOrders = await this.db
        .collection('orders')
        .where('productId', '==', productDoc.id)
        .limit(1)
        .get();

      if (relatedOrders.empty) {
        unsoldProductDocs.push(productDoc);
      } else {
        soldProductDocs.push(productDoc);
      }
    }

    const shipmentSnapshots = await Promise.all(
      orderIds.map((orderId) =>
        this.db.collection('shipments').where('orderId', '==', orderId).get(),
      ),
    );

    const shipmentDocs = shipmentSnapshots.flatMap((snapshot) => snapshot.docs);

    const uniqueShipmentDocs = Array.from(
      new Map(shipmentDocs.map((doc) => [doc.id, doc])).values(),
    );

    const likeProductAdjustments = new Map<string, number>();
    likesSnapshot.docs.forEach((doc) => {
      const productId = doc.data().productId;
      if (typeof productId === 'string' && productId.length > 0) {
        likeProductAdjustments.set(
          productId,
          (likeProductAdjustments.get(productId) || 0) + 1,
        );
      }
    });

    const deleteDocRefs = [
      ...userProfilesSnapshot.docs.map((doc) => doc.ref),
      ...unsoldProductDocs.map((doc) => doc.ref),
      ...likesSnapshot.docs.map((doc) => doc.ref),
    ];

    for (const refs of chunk(deleteDocRefs, FIRESTORE_BATCH_LIMIT)) {
      const batch: WriteBatch = this.db.batch();
      refs.forEach((ref) => {
        batch.delete(ref);
      });
      await batch.commit();
    }

    for (const [productId, decrementBy] of likeProductAdjustments.entries()) {
      const productRef = this.db.collection('products').doc(productId);
      await this.db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists) {
          return;
        }

        const data = productDoc.data() || {};
        const currentLikes =
          typeof data.likes === 'number' && data.likes >= 0 ? data.likes : 0;
        transaction.update(productRef, {
          likes: Math.max(0, currentLikes - decrementBy),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    }

    for (const doc of soldProductDocs) {
      await doc.ref.update({
        userId: DELETED_USER_MARKER,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    for (const doc of ordersSnapshot.docs) {
      const data = doc.data();
      const shipping = data.shipping || {};
      const address = shipping.address || {};

      await doc.ref.update({
        userId: DELETED_USER_MARKER,
        email: DELETED_EMAIL_MARKER,
        shipping: {
          ...shipping,
          name: REDACTED_VALUE,
          telephone: null,
          address: {
            ...address,
            line1: REDACTED_VALUE,
            line2: null,
            house_number: null,
            city: REDACTED_VALUE,
            state: null,
            postal_code: REDACTED_VALUE,
            country:
              typeof address.country === 'string' && address.country.length > 0
                ? address.country
                : 'GB',
          },
        },
      });
    }

    for (const doc of uniqueShipmentDocs) {
      const data = doc.data();
      const parcel = data.parcel || {};

      await doc.ref.update({
        parcel: {
          ...parcel,
          name: REDACTED_VALUE,
          address: REDACTED_VALUE,
          address_2: null,
          city: REDACTED_VALUE,
          email: null,
          telephone: null,
        },
        updatedAt: new Date(),
      });
    }

    return {
      deletedUserProfiles: userProfilesSnapshot.size,
      deletedUnsoldProducts: unsoldProductDocs.length,
      anonymisedProducts: soldProductDocs.length,
      anonymisedOrders: ordersSnapshot.size,
      anonymisedShipments: uniqueShipmentDocs.length,
      deletedLikes: likesSnapshot.size,
    };
  }
}
