export interface User {
    id?: string;
    firebaseUid?: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
    address?: {
        fullName: string;
        country: string;
        addressLine1: string;
        addressLine2?: string;
        postcode: string;
        city: string;
    };
    deletionStatus?: 'active' | 'pending_deletion' | 'deleted';
    deletionRequestedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

