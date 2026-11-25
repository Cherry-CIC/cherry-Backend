import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import { Charity } from '../model/Charity';

export interface CharityLike {
    id: string;
    userId: string;
    charityId: string;
    createdAt: Date;
}

export interface CharityLikeCursor {
    createdAt: Date;
    id: string;
}

export class CharityLikeRepository {
    private db = firestore;
    private likesCollection = 'charity_likes';
    private charitiesCollection = 'charities';

    async setLikeStatus(
        userId: string,
        charityId: string,
        like: boolean,
    ): Promise<{ charity: Charity; liked: boolean }> {
        const likeRef = this.db
            .collection(this.likesCollection)
            .doc(this.buildLikeId(userId, charityId));
        const charityRef = this.db.collection(this.charitiesCollection).doc(charityId);

        return this.db.runTransaction(async (transaction) => {
            const [likeDoc, charityDoc] = await Promise.all([
                transaction.get(likeRef),
                transaction.get(charityRef),
            ]);

            if (!charityDoc.exists) {
                throw new Error('Charity not found');
            }

            const data = charityDoc.data()!;
            const currentLikes =
                typeof data.likes === 'number' && data.likes >= 0 ? data.likes : 0;
            const alreadyLiked = likeDoc.exists;
            let nextLikes = currentLikes;

            if (like && !alreadyLiked) {
                transaction.set(likeRef, {
                    userId,
                    charityId,
                    createdAt: FieldValue.serverTimestamp(),
                });
                nextLikes += 1;
            } else if (!like && alreadyLiked) {
                transaction.delete(likeRef);
                nextLikes = Math.max(0, currentLikes - 1);
            }

            if (nextLikes !== currentLikes) {
                transaction.update(charityRef, {
                    likes: nextLikes,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            return {
                charity: {
                    id: charityDoc.id,
                    ...data,
                    likes: nextLikes,
                    createdAt:
                        data.createdAt instanceof Timestamp
                            ? data.createdAt.toDate()
                            : data.createdAt,
                    updatedAt: new Date(),
                } as Charity,
                liked: like,
            };
        });
    }

    async getLikedCharitiesPage(
        userId: string,
        limit: number,
        cursor?: CharityLikeCursor,
    ): Promise<{ likes: CharityLike[]; hasMore: boolean }> {
        let query: FirebaseFirestore.Query = this.db
            .collection(this.likesCollection)
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .orderBy('__name__', 'desc');

        if (cursor) {
            query = query.startAfter(cursor.createdAt, cursor.id);
        }

        const snapshot = await query.limit(limit + 1).get();
        const docs = snapshot.docs.slice(0, limit);

        return {
            likes: docs.map((doc) => {
                const data = doc.data();
                return {
                    id: doc.id,
                    userId: data.userId,
                    charityId: data.charityId,
                    createdAt:
                        data.createdAt instanceof Timestamp
                            ? data.createdAt.toDate()
                            : new Date(data.createdAt),
                };
            }),
            hasMore: snapshot.docs.length > limit,
        };
    }

    async deleteLikesByCharityId(charityId: string): Promise<void> {
        while (true) {
            const snapshot = await this.db
                .collection(this.likesCollection)
                .where('charityId', '==', charityId)
                .limit(450)
                .get();
            if (snapshot.empty) return;
            const batch = this.db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
            if (snapshot.size < 450) return;
        }
    }

    private buildLikeId(userId: string, charityId: string): string {
        return `${userId}_${charityId}`;
    }
}
