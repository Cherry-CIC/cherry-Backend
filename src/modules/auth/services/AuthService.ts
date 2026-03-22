import { admin } from '../../../shared/config/firebaseConfig';
import { UserRepository } from '../repositories/UserRepository';

export type DeleteAccountResult = {
  deletedUserProfiles: number;
  deletedProducts: number;
  deletedOrders: number;
  deletedShipments: number;
};

export interface IAuthService {
  deleteAccount(firebaseUid: string): Promise<DeleteAccountResult | null>;
}

export class AuthService implements IAuthService {
  constructor(
    private readonly userRepo: UserRepository = new UserRepository(),
  ) {}

  async deleteAccount(
    firebaseUid: string,
  ): Promise<DeleteAccountResult | null> {
    // Revoke refresh tokens first to mark all existing sessions as revoked.
    // This makes verifyIdToken(..., true) fail for already-issued tokens.
    try {
      await admin.auth().revokeRefreshTokens(firebaseUid);
    } catch (err: any) {
      const code = err && err.code ? err.code : null;
      // If user not found, continue to attempt cleanup of Firestore data.
      if (code && code !== 'auth/user-not-found') {
        throw err;
      }
    }

    // Try to delete the Firebase Auth user. If the user doesn't exist in Auth,
    // continue to attempt cleaning up Firestore data. This prevents returning
    // a 404 when the client has a valid ID token but the Firestore profile
    // is missing (e.g., created in Auth via other flow).
    try {
      await admin.auth().deleteUser(firebaseUid);
    } catch (err: any) {
      // If the Firebase Auth user doesn't exist, log and continue.
      // Only rethrow for unexpected errors.
      const code = err && err.code ? err.code : null;
      if (code && code !== 'auth/user-not-found') {
        throw err;
      }
    }

    // Delete associated Firestore documents (if any). This will return counts
    // even when no documents are found.
    const deletedCounts = await this.userRepo.deleteAccountData(firebaseUid);
    return deletedCounts;
  }
}
