export interface User {
    id?: string;
    firebaseUid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    createdAt?: Date;
    updatedAt?: Date;
}