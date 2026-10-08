import { DeletionError } from '../../account-deletion/config';

/** Legacy entry point deliberately fails closed: callers must supply the new receipt contract. */
export class AuthService {
  async deleteAccount(_firebaseUid: string): Promise<never> {
    throw new DeletionError('DELETION_CONTRACT_REQUIRED', 409);
  }
}
