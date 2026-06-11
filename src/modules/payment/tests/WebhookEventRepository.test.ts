// Verifies the real WebhookEventRepository against a mocked Firestore. Targets
// the atomic-claim race fix: the only safe primitive is documentRef.create(),
// which fails with ALREADY_EXISTS when the document is already present.
//
// These tests assert on the Firestore call shape, not on the implementation's
// internal helpers, so they catch regressions to the atomicity guarantee — e.g.
// a future refactor that reverts to get()-then-set() will fail here.

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockGet = jest.fn();
const mockDoc = jest.fn(() => ({
  create: mockCreate,
  update: mockUpdate,
  delete: mockDelete,
  get: mockGet,
}));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

// runTransaction receives a callback; execute it immediately with a mock transaction.
const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();
const mockRunTransaction = jest.fn(async (cb: (tx: any) => Promise<any>) =>
  cb({ get: mockTxGet, update: mockTxUpdate }),
);

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  },
}));

import { WebhookEventRepository } from '../WebhookEventRepository';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Returns a Firestore-style Timestamp-like object for a given Date. */
const tsLike = (d: Date) => ({ toDate: () => d });

/** Returns a mock document snapshot containing the given data. */
const snap = (data: Record<string, any>) => ({
  exists: true,
  data: () => data,
});

const missingSnap = () => ({ exists: false, data: () => undefined });

describe('WebhookEventRepository', () => {
  let repo: WebhookEventRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new WebhookEventRepository();
  });

  // ── claim() ────────────────────────────────────────────────────────────────

  describe('claim()', () => {
    it('uses documentRef.create() (atomic) — not get-then-set', async () => {
      mockCreate.mockResolvedValue(undefined);

      await repo.claim('evt_abc', 'payment_intent.succeeded');

      // The race fix depends on .create() — fail loudly if a refactor swaps it
      // back to .set() or get()-then-set().
      expect(mockCollection).toHaveBeenCalledWith('stripe_webhook_events');
      expect(mockDoc).toHaveBeenCalledWith('evt_abc');
      expect(mockCreate).toHaveBeenCalledTimes(1);

      const record = mockCreate.mock.calls[0][0];
      expect(record).toMatchObject({
        eventId: 'evt_abc',
        eventType: 'payment_intent.succeeded',
        status: 'processing',
      });
      expect(record.receivedAt).toBeInstanceOf(Date);
      expect(record.claimedAt).toBeInstanceOf(Date);
    });

    it("returns 'claimed' when the create succeeds (first delivery)", async () => {
      mockCreate.mockResolvedValue(undefined);

      const result = await repo.claim('evt_001', 'payment_intent.succeeded');

      expect(result).toBe('claimed');
    });

    it("returns 'already_processed' when existing doc has status 'processed' (numeric code 6)", async () => {
      const err: any = new Error('Document already exists');
      err.code = 6;
      mockCreate.mockRejectedValue(err);
      mockGet.mockResolvedValue(
        snap({ status: 'processed', claimedAt: tsLike(new Date()) }),
      );

      const result = await repo.claim('evt_002', 'payment_intent.succeeded');

      expect(result).toBe('already_processed');
    });

    it("returns 'already_processed' when existing doc has status 'processed' (string 'already-exists' code)", async () => {
      const err: any = new Error('Document already exists');
      err.code = 'already-exists';
      mockCreate.mockRejectedValue(err);
      mockGet.mockResolvedValue(
        snap({ status: 'processed', claimedAt: tsLike(new Date()) }),
      );

      const result = await repo.claim('evt_003', 'payment_intent.succeeded');

      expect(result).toBe('already_processed');
    });

    it("returns 'in_progress' when lease is fresh (claimedAt < TTL)", async () => {
      const err: any = new Error('Document already exists');
      err.code = 6;
      mockCreate.mockRejectedValue(err);

      // claimedAt is 1 second ago — well within the 5-minute TTL.
      const recentClaim = new Date(Date.now() - 1_000);
      mockGet.mockResolvedValue(
        snap({ status: 'processing', claimedAt: tsLike(recentClaim) }),
      );

      const result = await repo.claim('evt_004', 'payment_intent.succeeded');

      expect(result).toBe('in_progress');
      // No takeover transaction should be attempted for a fresh lease.
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it("takes over a stale lease and returns 'claimed'", async () => {
      const createErr: any = new Error('Document already exists');
      createErr.code = 6;
      mockCreate.mockRejectedValue(createErr);

      // claimedAt is 10 minutes ago — stale.
      const staleClaim = new Date(Date.now() - 10 * 60 * 1_000);
      mockGet.mockResolvedValue(
        snap({ status: 'processing', claimedAt: tsLike(staleClaim) }),
      );

      // Transaction: txGet returns the same stale doc; update succeeds.
      mockTxGet.mockResolvedValue(
        snap({ status: 'processing', claimedAt: tsLike(staleClaim) }),
      );
      mockTxUpdate.mockReturnValue(undefined);
      // mockRunTransaction already executes the callback — no additional setup needed.

      const result = await repo.claim('evt_005', 'payment_intent.succeeded');

      expect(result).toBe('claimed');
      expect(mockRunTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxUpdate).toHaveBeenCalledTimes(1);
      const updateArgs = mockTxUpdate.mock.calls[0][1];
      expect(updateArgs.status).toBe('processing');
      expect(updateArgs.claimedAt).toBeInstanceOf(Date);
    });

    it("yields 'in_progress' when another delivery renews lease inside the transaction", async () => {
      const createErr: any = new Error('Document already exists');
      createErr.code = 6;
      mockCreate.mockRejectedValue(createErr);

      // Initial read: stale.
      const staleClaim = new Date(Date.now() - 10 * 60 * 1_000);
      mockGet.mockResolvedValue(
        snap({ status: 'processing', claimedAt: tsLike(staleClaim) }),
      );

      // Inside transaction: another delivery has already renewed the lease.
      const freshClaim = new Date(Date.now() - 500);
      mockTxGet.mockResolvedValue(
        snap({ status: 'processing', claimedAt: tsLike(freshClaim) }),
      );

      const result = await repo.claim('evt_006', 'payment_intent.succeeded');

      expect(result).toBe('in_progress');
      expect(mockTxUpdate).not.toHaveBeenCalled();
    });

    it("yields 'in_progress' when the transaction itself fails (contention)", async () => {
      const createErr: any = new Error('Document already exists');
      createErr.code = 6;
      mockCreate.mockRejectedValue(createErr);

      const staleClaim = new Date(Date.now() - 10 * 60 * 1_000);
      mockGet.mockResolvedValue(
        snap({ status: 'processing', claimedAt: tsLike(staleClaim) }),
      );

      mockRunTransaction.mockRejectedValue(new Error('Transaction contention'));

      const result = await repo.claim('evt_007', 'payment_intent.succeeded');

      expect(result).toBe('in_progress');
    });

    it('rethrows non-ALREADY_EXISTS errors (so the controller can return 500)', async () => {
      // A transient Firestore failure must NOT be silently swallowed as a
      // duplicate — that would risk dropping real events.
      const err: any = new Error('Firestore unavailable');
      err.code = 14; // UNAVAILABLE
      mockCreate.mockRejectedValue(err);

      await expect(
        repo.claim('evt_008', 'payment_intent.succeeded'),
      ).rejects.toThrow('Firestore unavailable');
    });

    it('rethrows errors with no code property', async () => {
      // Defensive: an error without err.code is not a duplicate signal.
      mockCreate.mockRejectedValue(new Error('Network blip'));

      await expect(
        repo.claim('evt_009', 'payment_intent.succeeded'),
      ).rejects.toThrow('Network blip');
    });

    it('rethrows when document vanishes between create() failure and get()', async () => {
      const createErr: any = new Error('Document already exists');
      createErr.code = 6;
      mockCreate.mockRejectedValue(createErr);
      mockGet.mockResolvedValue(missingSnap());

      await expect(
        repo.claim('evt_010', 'payment_intent.succeeded'),
      ).rejects.toThrow(/disappeared during claim read/);
    });

    it('simulates a real concurrent race: only one of two simultaneous claims wins', async () => {
      // Real-world scenario: Stripe delivers the same event twice in <100ms.
      // The Firestore behaviour we mock here is: the first .create() succeeds,
      // the second fails with ALREADY_EXISTS. The repo must report exactly one
      // winner.
      let callCount = 0;
      mockCreate.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve();
        }
        const err: any = new Error('Document already exists');
        err.code = 6;
        return Promise.reject(err);
      });

      // The losing delivery will read the doc (fresh claimedAt → 'in_progress').
      mockGet.mockResolvedValue(
        snap({ status: 'processing', claimedAt: tsLike(new Date()) }),
      );

      const [first, second] = await Promise.all([
        repo.claim('evt_race', 'payment_intent.succeeded'),
        repo.claim('evt_race', 'payment_intent.succeeded'),
      ]);

      const winners = [first, second].filter((r) => r === 'claimed');
      expect(winners).toHaveLength(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  // ── markAsProcessed() ─────────────────────────────────────────────────────

  describe('markAsProcessed()', () => {
    it('updates the existing claim row to status=processed and stamps processedAt', async () => {
      mockUpdate.mockResolvedValue(undefined);

      await repo.markAsProcessed('evt_010', 'payment_intent.succeeded');

      expect(mockCollection).toHaveBeenCalledWith('stripe_webhook_events');
      expect(mockDoc).toHaveBeenCalledWith('evt_010');
      expect(mockUpdate).toHaveBeenCalledTimes(1);

      const update = mockUpdate.mock.calls[0][0];
      expect(update.eventType).toBe('payment_intent.succeeded');
      expect(update.status).toBe('processed');
      expect(update.processedAt).toBeInstanceOf(Date);
    });

    it('uses .update() not .set() — so it cannot accidentally create a row that bypassed claim()', async () => {
      mockUpdate.mockResolvedValue(undefined);

      await repo.markAsProcessed('evt_011', 'payment_intent.succeeded');

      // Hard guarantee: if a refactor swaps update() for set(), this test fails.
      // .set() would silently create the doc if claim() was skipped, which would
      // mean a "processed" row exists without the claim contention check ever
      // running.
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
  });

  // ── releaseClaim() ────────────────────────────────────────────────────────

  describe('releaseClaim()', () => {
    it('deletes the claim row so Stripe retries can re-acquire it', async () => {
      mockDelete.mockResolvedValue(undefined);

      await repo.releaseClaim('evt_020');

      expect(mockCollection).toHaveBeenCalledWith('stripe_webhook_events');
      expect(mockDoc).toHaveBeenCalledWith('evt_020');
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    it('propagates errors so the controller can log loudly', async () => {
      mockDelete.mockRejectedValue(new Error('Firestore delete failed'));

      await expect(repo.releaseClaim('evt_021')).rejects.toThrow(
        'Firestore delete failed',
      );
    });
  });
});
