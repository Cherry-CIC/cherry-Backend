export type ProductStatus = 'active' | 'unlisted' | 'sold';

export interface Product {
  id?: string;
  editVersion?: number;
  editSafetyVerified?: boolean;
  hasSales?: boolean;
  hasBeenEdited?: boolean;
  paymentReservationId?: string | null;
  name: string;
  description?: string;
  categoryId: string;
  charityId: string;
  postageSize?: string;
  userId: string;
  quality: string;
  size: string;
  product_images: string[];
  donation: number;
  price: number;
  likes: number;
  number: number;
  status: ProductStatus;
  createdAt?: Date;
  updatedAt?: Date;
}
