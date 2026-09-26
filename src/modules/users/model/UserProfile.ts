import { ProductStatus } from '../../products/model/Product';

/** The safe other-user profile contract. Account fields must never be added here. */
export interface UserProfile {
  id: string;
  username: string;
  profileImageUrl: string | null;
}

/** Only fields approved for another user's product list. */
export interface UserProduct {
  id: string;
  userId: string;
  name: string;
  description: string;
  quality: string;
  product_images: string[];
  donation: number;
  price: number;
  securityFee: number;
  likes: number;
  number: number;
  size: string;
  postageSize: string;
  categoryId?: string;
  charityId?: string;
  status: Extract<ProductStatus, 'active'>;
}

/** Keep Firestore's full timestamp precision for stable pagination. */
export interface UserProductPosition {
  seconds: number;
  nanoseconds: number;
  id: string;
}

export interface UserProductPage {
  products: UserProduct[];
  nextPosition: UserProductPosition | null;
}

export interface UserProductsQuery {
  limit: number;
  cursor?: string;
}

export interface UserProductsPage {
  data: { products: UserProduct[] };
  meta: { limit: number; nextCursor: string | null; hasMore: boolean };
}
