import { firestore } from '../shared/config/firebaseConfig';
import { Dispute, DisputeStatus } from '../disputes/Dispute';
import { OrderDisputeReason } from '../modules/order/model/Order';

const DISPUTE_REASONS: OrderDisputeReason[] = [
  'wrong_item',
  'item_not_as_described',
  'item_arrived_damaged',
  'something_else',
];

type MigrationResult = 'migrated' | 'already_linked' | 'conflict' | 'skipped';

const toDate = (value: unknown): Date | undefined => {
  if (!value) {
    return undefined;
  }
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const migrateOrder = async (
  orderId: string,
): Promise<MigrationResult> => {
  const orderRef = firestore.collection('orders').doc(orderId);
  const legacyDisputeRef = firestore.collection('disputes').doc(orderId);

  return firestore.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) {
      return 'skipped';
    }

    const order = orderSnapshot.data()!;
    if (order.buyerDisputeId) {
      return 'already_linked';
    }
    if (order.buyerDisputeStatus !== 'under_review') {
      return 'skipped';
    }
    if (
      !DISPUTE_REASONS.includes(order.buyerDisputeReason as OrderDisputeReason)
    ) {
      return 'skipped';
    }

    const legacyDisputeSnapshot = await transaction.get(legacyDisputeRef);
    if (legacyDisputeSnapshot.exists) {
      return 'conflict';
    }

    const productSnapshot = await transaction.get(
      firestore.collection('products').doc(order.productId),
    );
    const sellerId = productSnapshot.data()?.userId;
    if (typeof sellerId !== 'string' || typeof order.userId !== 'string') {
      return 'skipped';
    }

    const disputes = firestore.collection('disputes');
    let disputeRef = disputes.doc();
    while (disputeRef.id === orderId) {
      disputeRef = disputes.doc();
    }
    const submittedAt =
      toDate(order.buyerDisputedAt) ?? toDate(order.createdAt) ?? new Date();
    const status: DisputeStatus = 'under_review';
    const dispute: Dispute = {
      disputeId: disputeRef.id,
      orderId,
      buyerId: order.userId,
      sellerId,
      productId: order.productId,
      productName: order.productName,
      reason: order.buyerDisputeReason,
      ...(typeof order.buyerDisputeMessage === 'string'
        ? { message: order.buyerDisputeMessage }
        : {}),
      status,
      orderSnapshot: {
        totalAmount: order.totalAmount,
        currency: order.currency,
        paymentIntentId: order.paymentIntentId,
        orderStatus: order.status,
        shipmentStatus: order.shipmentStatus,
      },
      evidence: [],
      createdAt: submittedAt,
      updatedAt: submittedAt,
    };
    const eventRef = disputeRef.collection('events').doc();

    transaction.create(disputeRef, dispute);
    transaction.create(eventRef, {
      type: 'submitted',
      actorId: order.userId,
      actorRole: 'buyer',
      fromStatus: null,
      toStatus: status,
      createdAt: submittedAt,
    });
    transaction.update(orderRef, { buyerDisputeId: disputeRef.id });
    return 'migrated';
  });
};

const getConfirmedProject = (): string | undefined => {
  const projectIndex = process.argv.indexOf('--project');
  return projectIndex >= 0 ? process.argv[projectIndex + 1] : undefined;
};

const run = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const confirmedProjectId = getConfirmedProject();

  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID must be configured');
  }
  if (apply && confirmedProjectId !== projectId) {
    throw new Error(
      `For writes, pass --project ${projectId} to confirm the target project`,
    );
  }

  const snapshot = await firestore
    .collection('orders')
    .where('buyerDisputeStatus', '==', 'under_review')
    .get();
  const candidates = snapshot.docs.filter((doc) => !doc.data().buyerDisputeId);
  console.log(
    `${apply ? 'Applying migration to' : 'Dry run for'} ${projectId}: ` +
      `${candidates.length} legacy dispute order(s), ` +
      `${snapshot.size - candidates.length} already linked.`,
  );

  if (!apply) {
    console.log('No writes performed. Re-run with --apply --project <project-id>.');
    return;
  }

  const counts: Record<MigrationResult, number> = {
    migrated: 0,
    already_linked: 0,
    conflict: 0,
    skipped: 0,
  };
  for (const doc of candidates) {
    counts[await migrateOrder(doc.id)] += 1;
  }

  console.log(
    `Migration result: ${counts.migrated} migrated, ` +
      `${counts.already_linked} already linked, ${counts.skipped} skipped, ` +
      `${counts.conflict} legacy-path conflict(s).`,
  );
  if (counts.conflict > 0) {
    process.exitCode = 1;
  }
};

run().catch((error: unknown) => {
  console.error(
    'Dispute migration failed:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exitCode = 1;
});