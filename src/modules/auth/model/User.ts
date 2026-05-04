export interface User {
    id?: string;
    firebaseUid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    address?: {
        fullName: string;
        country: string;
        addressLine1: string;
        addressLine2?: string;
        postcode: string;
        city: string;
    };
    createdAt?: Date;
    updatedAt?: Date;
}
