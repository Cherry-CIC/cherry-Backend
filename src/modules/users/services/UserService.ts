import { admin, firestore } from '../../../shared/config/firebaseConfig';
import { FieldValue } from 'firebase-admin/firestore';
import { ProductRepository } from '../../products/repositories/ProductRepository';
import { Order } from '../../order/model/Order';
import { Product } from '../../products/model/Product';

export class UserService {
    private productRepo = new ProductRepository();

    /**
     * Check if a user has outstanding obligation blockers preventing deletion.
     */
    async checkBlockers(userId: string): Promise<Array<'pending_shipment' | 'active_order'>> {
        const blockingItemsSet = new Set<'pending_shipment' | 'active_order'>();

        // 1. Get orders where user is buyer
        const buyerOrdersSnapshot = await firestore.collection('orders')
            .where('userId', '==', userId)
            .get();
        const buyerOrders = buyerOrdersSnapshot.docs.map(doc => doc.data() as Order);

        // 2. Get products owned by user (seller)
        const productsSnapshot = await firestore.collection('products')
            .where('userId', '==', userId)
            .get();
        const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Product);

        let sellerOrders: Order[] = [];
        if (products.length > 0) {
            const productIds = products.map(p => p.id).filter((id): id is string => !!id);
            const orderPromises = [];
            // Firestore 'in' queries are limited to 10 items
            for (let i = 0; i < productIds.length; i += 10) {
                const chunk = productIds.slice(i, i + 10);
                orderPromises.push(
                    firestore.collection('orders')
                        .where('productId', 'in', chunk)
                        .get()
                );
            }
            const orderSnapshots = await Promise.all(orderPromises);
            sellerOrders = orderSnapshots.flatMap(snap => snap.docs.map(doc => doc.data() as Order));
        }

        const allOrders = [...buyerOrders, ...sellerOrders];

        for (const order of allOrders) {
            // paymentStatus === 'pending' or status === 'pending'
            if ((order.paymentStatus as string) === 'pending' || (order.status as string) === 'pending') {
                blockingItemsSet.add('active_order');
            }
            // paymentStatus === 'succeeded' and shipmentStatus is not in ['delivered', 'cancelled']
            if (order.paymentStatus === 'succeeded' && !['delivered', 'cancelled'].includes(order.shipmentStatus)) {
                blockingItemsSet.add('pending_shipment');
            }
        }

        return Array.from(blockingItemsSet);
    }

    /**
     * Fully delete the user's Firebase Auth account, anonymize the user profile,
     * and deactivate all user's listings.
     */
    async deleteAccountFully(userId: string): Promise<void> {
        // 1. Delete Firebase Auth user
        try {
            await admin.auth().deleteUser(userId);
        } catch (error: any) {
            const code = error && error.code ? error.code : null;
            if (code && code !== 'auth/user-not-found') {
                throw error;
            }
            console.warn(`Firebase Auth user ${userId} not found or already deleted:`, error.message);
        }

        // 2. Anonymize user profile in Firestore
        const userQuery = await firestore.collection('users')
            .where('id', '==', userId)
            .limit(1)
            .get();

        if (!userQuery.empty) {
            const userDoc = userQuery.docs[0];
            await userDoc.ref.update({
                deletionStatus: 'deleted',
                displayName: 'Deleted User',
                email: FieldValue.delete(),
                address: FieldValue.delete(),
                photoURL: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp()
            });
        }

        // 3. Deactivate all listings owned by the user
        await this.productRepo.deactivateProductsByUserId(userId);
    }

    /**
     * Mark the user as pending_deletion.
     */
    async queueDeletion(userId: string): Promise<void> {
        const userQuery = await firestore.collection('users')
            .where('id', '==', userId)
            .limit(1)
            .get();

        if (userQuery.empty) {
            throw new Error('User profile not found');
        }

        const userDoc = userQuery.docs[0];
        await userDoc.ref.update({
            deletionStatus: 'pending_deletion',
            deletionRequestedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
    }

    /**
     * Periodically check and process pending deletion requests.
     */
    async processScheduledDeletions(limit: number = 100): Promise<{ processed: number; deleted: number }> {
        const snapshot = await firestore.collection('users')
            .where('deletionStatus', '==', 'pending_deletion')
            .limit(limit)
            .get();

        let deletedCount = 0;
        for (const doc of snapshot.docs) {
            const userData = doc.data();
            const firebaseUid = userData.id;
            if (!firebaseUid) continue;

            const blockers = await this.checkBlockers(firebaseUid);
            if (blockers.length === 0) {
                await this.deleteAccountFully(firebaseUid);
                deletedCount++;
            }
        }

        return {
            processed: snapshot.size,
            deleted: deletedCount
        };
    }
}
