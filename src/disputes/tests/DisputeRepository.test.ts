import { DisputeRepository } from '../DisputeRepository';
import { DisputeAdminError } from '../Dispute';

const mockCollection = jest.fn();
const mockRunTransaction = jest.fn();

jest.mock('../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: (name: string) => mockCollection(name),
    runTransaction: (callback: (transaction: unknown) => Promise<unknown>) =>
      mockRunTransaction(callback),
  },
}));

describe('DisputeRepository transactions', () => {
  const disputeRef: any = { id: 'dispute-1' };
  const orderRef: any = { id: 'order-1' };
  const events: { data: Record<string, unknown> }[] = [];
  const disputeData: Record<string, any> = {};
  const orderData: Record<string, any> = {};
  const idempotencyData: Record<string, Record<string, any>> = {};
  const idempotencyRefs = new Map<string, any>();
  let eventSequence = 0;
  let transactionTail: Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    events.splice(0);
    Object.keys(idempotencyData).forEach((key) => delete idempotencyData[key]);
    idempotencyRefs.clear();
    eventSequence = 0;
    transactionTail = Promise.resolve();

    Object.assign(disputeData, {
      disputeId: 'dispute-1',
      orderId: 'order-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      productId: 'product-1',
      productName: 'Coat',
      reason: 'wrong_item',
      status: 'raised',
      orderSnapshot: {
        totalAmount: 1000,
        currency: 'GBP',
        paymentIntentId: 'pi_test',
        orderStatus: 'delivered',
        shipmentStatus: 'delivered',
      },
      evidence: [],
      createdAt: new Date('2026-10-01T09:00:00.000Z'),
      updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    });
    delete disputeData.assignedAdminId;
    delete disputeData.claimedAt;
    Object.assign(orderData, { buyerDisputeStatus: 'raised' });

    const eventCollection = {
      doc: () => ({ id: `event-${++eventSequence}` }),
    };
    const idempotencyCollection = {
      doc: (id: string) => {
        if (!idempotencyRefs.has(id)) {
          idempotencyRefs.set(id, { id, kind: 'idempotency' });
        }
        return idempotencyRefs.get(id);
      },
    };
    disputeRef.collection = jest.fn((name: string) =>
      name === 'events' ? eventCollection : idempotencyCollection,
    );

    mockCollection.mockImplementation((name: string) => {
      if (name === 'disputes') {
        return { doc: jest.fn(() => disputeRef) };
      }
      if (name === 'orders') {
        return { doc: jest.fn(() => orderRef) };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    mockRunTransaction.mockImplementation(
      async (callback: (transaction: any) => Promise<unknown>) => {
        const previous = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;

        const writes: {
          type: 'create' | 'update';
          ref: any;
          data: Record<string, unknown>;
        }[] = [];
        const transaction = {
          get: jest.fn(async (ref: any) => {
            if (ref === disputeRef) {
              return {
                exists: true,
                id: disputeRef.id,
                data: () => ({ ...disputeData }),
              };
            }
            if (ref === orderRef) {
              return { exists: true, data: () => ({ ...orderData }) };
            }
            if (ref.kind === 'idempotency') {
              const data = idempotencyData[ref.id];
              return {
                exists: Boolean(data),
                data: () => (data ? { ...data } : undefined),
              };
            }
            throw new Error('Unexpected document reference');
          }),
          create: (ref: any, data: Record<string, unknown>) => {
            writes.push({ type: 'create', ref, data });
          },
          update: (ref: any, data: Record<string, unknown>) => {
            writes.push({ type: 'update', ref, data });
          },
        };

        try {
          const result = await callback(transaction);
          for (const write of writes) {
            if (write.type === 'create') {
              if (write.ref.kind === 'idempotency') {
                idempotencyData[write.ref.id] = write.data;
              } else {
                events.push({ data: write.data });
              }
            } else if (write.ref === disputeRef) {
              Object.assign(disputeData, write.data);
            } else if (write.ref === orderRef) {
              Object.assign(orderData, write.data);
            }
          }
          return result;
        } finally {
          release();
        }
      },
    );
  });

  it('allows only one of two competing admins to claim a dispute', async () => {
    const repository = new DisputeRepository();
    const results = await Promise.allSettled([
      repository.claimDispute('dispute-1', 'admin-1'),
      repository.claimDispute('dispute-1', 'admin-2'),
    ]);

    const fulfilled = results.filter(
      (result) => result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(DisputeAdminError);
    expect(rejected[0].reason.code).toBe('dispute_already_claimed');
    expect(['admin-1', 'admin-2']).toContain(disputeData.assignedAdminId);
    expect(disputeData.status).toBe('in_progress');
    expect(orderData.buyerDisputeStatus).toBe('in_progress');
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual(
      expect.objectContaining({
        type: 'claimed',
        actorId: disputeData.assignedAdminId,
        actorRole: 'admin',
        fromStatus: 'raised',
        toStatus: 'in_progress',
      }),
    );
  });

  it('makes a repeated claim by the assigned admin idempotent', async () => {
    const repository = new DisputeRepository();

    const firstClaim = await repository.claimDispute('dispute-1', 'admin-1');
    const repeatedClaim = await repository.claimDispute('dispute-1', 'admin-1');

    expect(repeatedClaim.assignedAdminId).toBe('admin-1');
    expect(repeatedClaim.status).toBe('in_progress');
    expect(firstClaim.claimedAt).toEqual(repeatedClaim.claimedAt);
    expect(events).toHaveLength(1);
  });

  it('returns the original result for a repeated status request with the same key', async () => {
    const repository = new DisputeRepository();
    disputeData.status = 'in_progress';
    disputeData.assignedAdminId = 'admin-1';
    orderData.buyerDisputeStatus = 'in_progress';

    const firstResult = await repository.moderateDispute(
      'dispute-1',
      'admin-1',
      'resolved',
      'Decision recorded.',
      'resolve-key-1',
    );
    const repeatedResult = await repository.moderateDispute(
      'dispute-1',
      'admin-1',
      'resolved',
      'Decision recorded.',
      'resolve-key-1',
    );

    expect(repeatedResult).toEqual(firstResult);
    expect(disputeData.status).toBe('resolved');
    expect(orderData.buyerDisputeStatus).toBe('resolved');
    expect(events).toHaveLength(1);
    expect(events[0].data.type).toBe('status_changed');
    expect(Object.keys(idempotencyData)).toHaveLength(1);
  });

  it('rejects reuse of an idempotency key for a different status request', async () => {
    const repository = new DisputeRepository();
    disputeData.status = 'in_progress';
    disputeData.assignedAdminId = 'admin-1';

    await repository.moderateDispute(
      'dispute-1',
      'admin-1',
      'resolved',
      'Decision recorded.',
      'resolve-key-1',
    );

    await expect(
      repository.moderateDispute(
        'dispute-1',
        'admin-1',
        'resolved',
        'Different explanation.',
        'resolve-key-1',
      ),
    ).rejects.toMatchObject({ code: 'idempotency_key_reused' });
    expect(events).toHaveLength(1);
    expect(disputeData.resolution.note).toBe('Decision recorded.');
  });
});