import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import { Product } from '../model/Product';

export interface ProductLike {
    id: string;
    userId: string;
    productId: string;
    createdAt: Date;
}

export interface ProductLikeCursor {
    createdAt: Date;
    id: string;
}

export interface ProductLikePage {
    likes: ProductLike[];
    hasMore: boolean;
}

export class ProductLikeRepository {
    private db = firestore;
    private likesCollection = 'user_likes';
    private productsCollection = 'products';

    async setLikeStatus(
        userId: string,
        productId: string,
        like: boolean,
    ): Promise<{ product: Product; liked: boolean }> {
        const likeId = this.buildLikeId(userId, productId);
        const likeRef = this.db.collection(this.likesCollection).doc(likeId);
        const productRef = this.db.collection(this.productsCollection).doc(productId);

        return this.db.runTransaction(async (transaction) => {
            const [likeDoc, productDoc] = await Promise.all([
                transaction.get(likeRef),
                transaction.get(productRef),
            ]);

            if (!productDoc.exists) {
                throw new Error('Product not found');
            }

            const data = productDoc.data()!;
            const currentLikes =
                typeof data.likes === 'number' && data.likes >= 0 ? data.likes : 0;
            const alreadyLiked = likeDoc.exists;

            let nextLikes = currentLikes;
            if (like && !alreadyLiked) {
                transaction.set(likeRef, {
                    userId,
                    productId,
                    createdAt: FieldValue.serverTimestamp(),
                });
                nextLikes = currentLikes + 1;
            } else if (!like && alreadyLiked) {
                transaction.delete(likeRef);
                nextLikes = Math.max(0, currentLikes - 1);
            }

            if (nextLikes !== currentLikes) {
                transaction.update(productRef, {
                    likes: nextLikes,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            return {
                product: {
                    id: productDoc.id,
                    ...data,
                    likes: nextLikes,
                    createdAt:
                        data.createdAt instanceof Timestamp
                            ? data.createdAt.toDate()
                            : data.createdAt,
                    updatedAt: new Date(),
                } as Product,
                liked: like,
            };
        });
    }

    async getLikedProductsPage(
        userId: string,
        limit: number,
        cursor?: ProductLikeCursor,
    ): Promise<ProductLikePage> {
        let query: FirebaseFirestore.Query = this.db
            .collection(this.likesCollection)
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .orderBy(FieldPath.documentId(), 'desc');

        if (cursor) {
            query = query.startAfter(cursor.createdAt, cursor.id);
        }

        const snapshot = await query.limit(limit + 1).get();
        const docs = snapshot.docs.slice(0, limit);

        return {
            likes: docs.map((doc) => {
                const data = doc.data();
                const createdAt =
                    data.createdAt instanceof Timestamp
                        ? data.createdAt.toDate()
                        : new Date(data.createdAt);

                return {
                    id: doc.id,
                    userId: data.userId,
                    productId: data.productId,
                    createdAt,
                };
            }),
            hasMore: snapshot.docs.length > limit,
        };
    }

    async deleteLikesByUserId(firebaseUid: string): Promise<number> {
        const snapshot = await this.db
            .collection(this.likesCollection)
            .where('userId', '==', firebaseUid)
            .get();

        if (snapshot.empty) {
            return 0;
        }

        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        return snapshot.size;
    }

    private buildLikeId(userId: string, productId: string): string {
        return `${userId}_${productId}`;
    }
}
