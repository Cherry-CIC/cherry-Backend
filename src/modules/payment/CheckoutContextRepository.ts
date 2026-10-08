import { randomUUID } from 'node:crypto';
import { firestore } from '../../shared/config/firebaseConfig';
import { assertAccountsActive } from '../account-deletion/access';
import { gbpToPence } from '../../shared/utils/money';

export const CHECKOUT_CONTEXTS = 'account_checkout_contexts';
export const UNRESOLVED_CHECKOUT_STATES = [
  'preparing',
  'open',
  'succeeded',
  'needs_review',
];

/** Query inside the listing transaction: a racing checkout must retry against the mutation. */
export async function assertNoUnresolvedCheckouts(
  transaction: FirebaseFirestore.Transaction,
  productId: string,
  db: FirebaseFirestore.Firestore = firestore,
): Promise<void> {
  const contexts = await transaction.get(
    db
      .collection(CHECKOUT_CONTEXTS)
      .where('productId', '==', productId)
      .where('state', 'in', UNRESOLVED_CHECKOUT_STATES)
      .limit(1),
  );
  if (!contexts.empty) throw new Error('Product has an unresolved checkout');
}

export interface CheckoutContext {
  buyerUid: string;
  sellerUid: string;
  productId: string;
  productName: string;
  buyerEmail: string;
  charityId: string | null;
  postageSize: string | null;
  snapshotVersion: 1;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  state:
    | 'preparing'
    | 'open'
    | 'succeeded'
    | 'cancelled'
    | 'fulfilled'
    | 'needs_review';
  paymentIntentId?: string;
  customerId?: string;
  orderId?: string;
}

export class CheckoutContextRepository {
  /** This transaction is the checkout acceptance point, before any provider call. */
  async start(
    input: Omit<
      CheckoutContext,
      | 'createdAt'
      | 'updatedAt'
      | 'state'
      | 'charityId'
      | 'postageSize'
      | 'snapshotVersion'
    >,
  ): Promise<string> {
    const ref = firestore.collection(CHECKOUT_CONTEXTS).doc(randomUUID());
    await firestore.runTransaction(async (transaction) => {
      const product = await transaction.get(
        firestore.collection('products').doc(input.productId),
      );
      await assertAccountsActive(transaction, [
        input.buyerUid,
        input.sellerUid,
      ]);
      if (
        !product.exists ||
        product.data()!.userId !== input.sellerUid ||
        product.data()!.number <= 0 ||
        (product.data()!.status || 'active') !== 'active'
      ) {
        throw new Error('Product is unavailable');
      }
      if (
        gbpToPence(product.data()!.price) !==
        Number(input.metadata.productAmount)
      ) {
        throw new Error('Product price changed');
      }
      const productData = product.data()!;
      // Actual checkout metadata always includes a weight. Validate the selected
      // postage definition in the same transaction, after the shipping quote.
      if (input.metadata.shippingWeight !== undefined) {
        if (typeof productData.postageSize !== 'string')
          throw new Error('Product postage size changed');
        const postage = await transaction.get(
          firestore.collection('postage_sizes').doc(productData.postageSize),
        );
        if (
          !postage.exists ||
          postage.data()!.weight !== Number(input.metadata.shippingWeight)
        ) {
          throw new Error('Product postage size changed');
        }
      }
      transaction.create(ref, {
        ...input,
        charityId:
          typeof productData.charityId === 'string'
            ? productData.charityId
            : null,
        postageSize:
          typeof productData.postageSize === 'string'
            ? productData.postageSize
            : null,
        snapshotVersion: 1,
        state: 'preparing',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    return ref.id;
  }

  async get(id: string): Promise<CheckoutContext | null> {
    const doc = await firestore.collection(CHECKOUT_CONTEXTS).doc(id).get();
    return doc.exists ? (doc.data() as CheckoutContext) : null;
  }

  /** Never store client secrets or ephemeral keys in durable context. */
  async attachPayment(
    id: string,
    paymentIntentId: string,
    customerId: string,
  ): Promise<void> {
    const ref = firestore.collection(CHECKOUT_CONTEXTS).doc(id);
    await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) throw new Error('Checkout context not found');
      const data = doc.data()!;
      if (data.paymentIntentId && data.paymentIntentId !== paymentIntentId)
        throw new Error('Checkout payment mismatch');
      transaction.update(ref, {
        paymentIntentId,
        customerId,
        updatedAt: new Date(),
        ...(data.state === 'preparing' ? { state: 'open' } : {}),
      });
    });
  }

  async flagUncertain(id: string): Promise<void> {
    const ref = firestore.collection(CHECKOUT_CONTEXTS).doc(id);
    await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (doc.exists && ['preparing', 'open'].includes(doc.data()!.state)) {
        transaction.update(ref, {
          state: 'needs_review',
          updatedAt: new Date(),
        });
      }
    });
  }

  /** Read-only provider reconciliation; callers must retrieve/verify the Stripe object. */
  async recordProviderState(
    id: string,
    paymentIntentId: string,
    state: 'succeeded' | 'cancelled',
    metadata: Record<string, string>,
  ): Promise<void> {
    const ref = firestore.collection(CHECKOUT_CONTEXTS).doc(id);
    await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      // A late duplicate after justified expiry must not recreate erased context.
      if (!doc.exists) return;
      const data = doc.data()!;
      if (
        data.buyerUid !== metadata.firebaseUid ||
        data.productId !== metadata.productId ||
        (data.paymentIntentId && data.paymentIntentId !== paymentIntentId)
      ) {
        throw new Error('Checkout payment mismatch');
      }
      if (data.state === 'fulfilled' || data.state === 'succeeded') return;
      transaction.update(ref, {
        state,
        paymentIntentId,
        updatedAt: new Date(),
      });
    });
  }
}
