import { admin } from '../../../shared/config/firebaseConfig';
import { UserRepository } from '../repositories/UserRepository';

export type DeleteAccountResult = {
  deletedUserProfiles: number;
  deletedUnsoldProducts: number;
  anonymisedProducts: number;
  anonymisedOrders: number;
  anonymisedShipments: number;
  deletedLikes: number;
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

    // Perform Firestore cleanup before deleting the auth user so a cleanup
    // failure does not leave the user locked out while their data remains.
    const deletedCounts = await this.userRepo.deleteAccountData(firebaseUid);

    // Delete the Firebase Auth user after cleanup. If the auth user is already
    // gone, continue returning the cleanup summary.
    try {
      await admin.auth().deleteUser(firebaseUid);
    } catch (err: any) {
      const code = err && err.code ? err.code : null;
      if (code && code !== 'auth/user-not-found') {
        throw err;
      }
    }

    return deletedCounts;
  }
}
