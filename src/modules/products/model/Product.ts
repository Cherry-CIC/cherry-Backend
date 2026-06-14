export interface Product {
    id?: string;
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
    visibilityStatus?: 'active' | 'inactive';
    createdAt?: Date;
    updatedAt?: Date;
}
