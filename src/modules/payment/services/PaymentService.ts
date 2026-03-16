import { PaymentRepository } from '../PaymentRepository';
import { UserRepository } from '../../auth/repositories/UserRepository';

/**
 * Service that coordinates between the User repository and the Payment repository.
 * It retrieves the authenticated user's email using the Firebase UID and then
 * creates a Stripe PaymentIntent via the PaymentRepository.
 */
export class PaymentService {
  private paymentRepo = new PaymentRepository();
  private userRepo = new UserRepository();

  /**
   * Creates a Stripe PaymentIntent for a user identified by Firebase UID.
   * @param firebaseUid - Firebase UID of the authenticated user.
   * @param amount - Amount in the smallest currency unit (e.g., cents).
   * @returns An object containing the client secret, ephemeral key, customer ID, and publishable key.
   */
  async createPaymentIntentForUserByUid(
    firebaseUid: string,
    amount: number
  ) {
    // Fetch user to obtain email
    const user = await this.userRepo.getByFirebaseUid(firebaseUid);
    if (!user) {
      throw new Error('User not found');
    }
    const email = user.email;

    // Delegate to the payment repository which handles Stripe logic
    return await this.paymentRepo.createPaymentIntentForUser(email, amount);
  }
}