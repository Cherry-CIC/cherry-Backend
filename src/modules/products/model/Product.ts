export interface Product {
    id?: string;
    name: string;
    description?: string;
    categoryId: string;
    charityId: string;
    userId: string;
    quality: string;
    size: string;
    product_images: string[];
    donation: number;
    price: number;
    likes: number;
    likedBy?: string[]; // PRIVATE: Never expose in API responses - Array of user IDs who liked this product
    number: number;
    createdAt?: Date;
    updatedAt?: Date;
}
