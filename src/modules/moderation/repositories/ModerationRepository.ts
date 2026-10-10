import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import { admin } from '../../../shared/config/firebaseConfig';

export type ProductModerationAction = 'hide' | 'restore';
export type UserModerationAction = 'warn' | 'suspend' | 'restore';

export class ModerationRepository {
  constructor(private readonly db = firestore) {}

  async moderateProduct(
    productId: string,
    action: ProductModerationAction,
    adminId: string,
    reason: string,
  ): Promise<boolean> {
    const ref = this.db.collection('products').doc(productId);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.update({
      moderationStatus: action === 'hide' ? 'hidden' : 'approved',
      moderationReason: reason,
      moderationUpdatedAt: FieldValue.serverTimestamp(),
      moderationUpdatedBy: adminId,
      hidden: action === 'hide',
      hiddenAt: action === 'hide' ? FieldValue.serverTimestamp() : null,
    });
    return true;
  }

  async moderateUser(
    userId: string,
    action: UserModerationAction,
    adminId: string,
    reason: string,
  ): Promise<boolean> {
    const userSnapshot = await this.db
      .collection('users')
      .where('id', '==', userId)
      .limit(1)
      .get();
    const userRef = userSnapshot.empty ? null : userSnapshot.docs[0].ref;
    if (action === 'warn') {
      if (!userRef) {
        return false;
      }
      await userRef.update({
        warningReason: reason,
        warnedAt: FieldValue.serverTimestamp(),
        warnedBy: adminId,
      });
      return true;
    }

    const suspended = action === 'suspend';
    if (userRef) {
      await userRef.update({
        status: suspended ? 'suspended' : 'active',
        suspensionReason: suspended ? reason : null,
        suspendedAt: suspended ? FieldValue.serverTimestamp() : null,
        suspendedBy: suspended ? adminId : null,
        moderationUpdatedAt: FieldValue.serverTimestamp(),
        moderationUpdatedBy: adminId,
      });
    }
    try {
      await admin.auth().updateUser(userId, { disabled: suspended });
    } catch (error: any) {
      if (error?.code !== 'auth/user-not-found') throw error;
      if (!userRef) return false;
    }
    return Boolean(userRef) || action === 'restore' || action === 'suspend';
  }
}
