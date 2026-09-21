/** The complete public user contract. Account fields must never be added here. */
export interface PublicUser {
  id: string;
  username: string;
  profileImageUrl: string | null;
}

/** Only fields approved for the public profile and listing-detail contract. */
export interface PublicProduct {
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
  status: 'active';
  visibility: 'public';
}

/** Keep Firestore's full timestamp precision for stable pagination. */
export interface PublicProductPosition {
  seconds: number;
  nanoseconds: number;
  id: string;
}

export interface PublicProductPage {
  products: PublicProduct[];
  nextPosition: PublicProductPosition | null;
}

export interface PublicProfileQuery {
  limit: number;
  cursor?: string;
}

export interface PublicProfileData {
  user: PublicUser;
  products: PublicProduct[];
}

export interface PublicProfilePage {
  data: PublicProfileData;
  meta: { limit: number; nextCursor: string | null; hasMore: boolean };
}
