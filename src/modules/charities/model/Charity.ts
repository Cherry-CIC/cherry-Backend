export interface Charity {
    id?: string;
    name: string;
    description: string;
    imageUrl: string;
    website?: string;
    likes: number;
    createdAt?: Date;
    updatedAt?: Date;
}
