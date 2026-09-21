import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../../../shared/config/firebaseConfig';
import { calculateSecurityFeePence } from '../../../shared/config/checkoutConfig';
import { gbpToPence } from '../../../shared/utils/money';
import {
  PublicProduct,
  PublicProductPage,
  PublicProductPosition,
} from '../model/PublicProfile';

const SCAN_CHUNK_SIZE = 100;
const MAX_SCANNED_PRODUCTS = 5000;

const publicText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const publicIdentifier = (value: unknown): string | null => {
  const id = publicText(value);
  // Stored identifiers must never be normalised into a different document ID.
  return id &&
    id === value &&
    id !== '.' &&
    id !== '..' &&
    !/[\/\\\x00-\x1f\x7f-\x9f]/.test(id)
    ? id
    : null;
};

const publicImageUrl = (value: unknown): string | null => {
  const text = publicText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const validMoney = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  Number.isSafeInteger(gbpToPence(value));

/**
 * Legacy products have no visibility/moderation fields. Their established
 * publication rule is active status and positive stock. Missing fields retain
 * that rule; explicitly stored states must be recognised and public. Future
 * moderation schemas must update this policy and the cursor policy version.
 */
const publicationPermitsDisplay = (
  data: FirebaseFirestore.DocumentData,
): boolean => {
  if (
    (data.visibility !== undefined && data.visibility !== 'public') ||
    (data.moderationStatus !== undefined &&
      data.moderationStatus !== 'approved') ||
    (data.publicationStatus !== undefined &&
      data.publicationStatus !== 'published') ||
    data.moderation !== undefined ||
    data.publication !== undefined
  ) {
    return false;
  }

  const flags = [
    'deleted',
    'isDeleted',
    'removed',
    'isRemoved',
    'hidden',
    'isHidden',
    'moderationHidden',
  ];
  if (
    flags.some((field) => data[field] !== undefined && data[field] !== false)
  ) {
    return false;
  }

  return ['deletedAt', 'removedAt', 'hiddenAt'].every(
    (field) => data[field] === undefined || data[field] === null,
  );
};

/** Explicit projection prevents private relations and future fields leaking. */
const mapPublicProduct = (
  id: string,
  data: FirebaseFirestore.DocumentData,
  ownerId: string,
): PublicProduct | null => {
  if (
    ownerId === 'deleted_user' ||
    data.userId !== ownerId ||
    data.status !== 'active' ||
    !Number.isSafeInteger(data.number) ||
    data.number <= 0 ||
    !publicationPermitsDisplay(data)
  ) {
    return null;
  }

  const productId = publicIdentifier(id);
  const name = publicText(data.name);
  const quality = publicText(data.quality);
  const size = publicText(data.size);
  const postageSize = publicIdentifier(data.postageSize);
  const likes = data.likes === undefined ? 0 : data.likes;
  if (
    !productId ||
    !name ||
    !quality ||
    !size ||
    !postageSize ||
    (data.description !== undefined && typeof data.description !== 'string') ||
    !Array.isArray(data.product_images) ||
    !validMoney(data.price) ||
    !validMoney(data.donation) ||
    !Number.isSafeInteger(likes) ||
    likes < 0
  ) {
    return null;
  }

  const product: PublicProduct = {
    id: productId,
    userId: ownerId,
    name,
    description: data.description ?? '',
    quality,
    product_images: data.product_images
      .map(publicImageUrl)
      .filter((value): value is string => value !== null),
    donation: data.donation,
    price: data.price,
    securityFee: calculateSecurityFeePence(gbpToPence(data.price)) / 100,
    likes,
    number: data.number,
    size,
    postageSize,
    status: 'active',
    visibility: 'public',
  };

  const categoryId = publicIdentifier(data.categoryId);
  const charityId = publicIdentifier(data.charityId);
  if (categoryId) product.categoryId = categoryId;
  if (charityId) product.charityId = charityId;
  return product;
};

export class PublicProductRepository {
  constructor(private readonly db: FirebaseFirestore.Firestore = firestore) {}

  async getPublicPage(
    ownerId: string,
    limit: number,
    cursor?: PublicProductPosition,
  ): Promise<PublicProductPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Invalid public product page size');
    }
    if (ownerId === 'deleted_user') {
      return { products: [], nextPosition: null };
    }

    const baseQuery = this.db
      .collection('products')
      .where('userId', '==', ownerId)
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    let query = cursor
      ? baseQuery.startAfter(
          new Timestamp(cursor.seconds, cursor.nanoseconds),
          cursor.id,
        )
      : baseQuery;
    const publicRecords: {
      product: PublicProduct;
      position: PublicProductPosition;
    }[] = [];
    let scanned = 0;
    let exhausted = false;
    // Seller badges request limit=1. Read only the page and lookahead first;
    // larger follow-up batches keep sparse inventories efficient to scan.
    let batchSize = limit + 1;

    while (publicRecords.length < limit + 1 && !exhausted) {
      const sourceLimit = Math.min(batchSize, MAX_SCANNED_PRODUCTS - scanned);
      if (sourceLimit === 0) {
        // Fail retryably instead of revealing a misleading partial/empty page.
        throw new Error('Public product scan limit exceeded');
      }

      const snapshot = await query.limit(sourceLimit).get();
      scanned += snapshot.docs.length;
      exhausted = snapshot.docs.length < sourceLimit;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        // A precise Firestore timestamp is required for a reproducible cursor.
        if (!(data.createdAt instanceof Timestamp)) continue;
        const product = mapPublicProduct(doc.id, data, ownerId);
        if (!product) continue;
        publicRecords.push({
          product,
          position: {
            seconds: data.createdAt.seconds,
            nanoseconds: data.createdAt.nanoseconds,
            id: doc.id,
          },
        });
        if (publicRecords.length === limit + 1) break;
      }

      if (!exhausted && publicRecords.length < limit + 1) {
        // Snapshot cursors safely skip malformed timestamps in the source scan.
        // They never leave the server or determine client pagination metadata.
        query = baseQuery.startAfter(snapshot.docs[snapshot.docs.length - 1]);
        batchSize = SCAN_CHUNK_SIZE;
      }
    }

    const page = publicRecords.slice(0, limit);
    return {
      products: page.map(({ product }) => product),
      nextPosition:
        publicRecords.length > limit ? page[page.length - 1].position : null,
    };
  }
}
