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
    number: number;
    createdAt?: Date;
    updatedAt?: Date;
}
