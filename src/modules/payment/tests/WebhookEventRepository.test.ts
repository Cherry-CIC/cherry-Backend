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
const mockDoc = jest.fn(() => ({
  create: mockCreate,
  update: mockUpdate,
  delete: mockDelete,
}));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: { collection: mockCollection },
}));

import { WebhookEventRepository } from '../WebhookEventRepository';

describe('WebhookEventRepository', () => {
  let repo: WebhookEventRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new WebhookEventRepository();
  });

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
    });

    it('returns true when the create succeeds (claim acquired)', async () => {
      mockCreate.mockResolvedValue(undefined);

      const result = await repo.claim('evt_001', 'payment_intent.succeeded');

      expect(result).toBe(true);
    });

    it('returns false when Firestore rejects with numeric ALREADY_EXISTS code 6', async () => {
      // The Firestore admin SDK surfaces ALREADY_EXISTS as gRPC code 6.
      const err: any = new Error('Document already exists');
      err.code = 6;
      mockCreate.mockRejectedValue(err);

      const result = await repo.claim('evt_002', 'payment_intent.succeeded');

      expect(result).toBe(false);
    });

    it('returns false when Firestore rejects with string "already-exists" code', async () => {
      // Some Firestore client paths use the string form. Both must be treated
      // as duplicates, not as fatal errors.
      const err: any = new Error('Document already exists');
      err.code = 'already-exists';
      mockCreate.mockRejectedValue(err);

      const result = await repo.claim('evt_003', 'payment_intent.succeeded');

      expect(result).toBe(false);
    });

    it('rethrows non-ALREADY_EXISTS errors (so the controller can return 500)', async () => {
      // A transient Firestore failure must NOT be silently swallowed as a
      // duplicate — that would risk dropping real events.
      const err: any = new Error('Firestore unavailable');
      err.code = 14; // UNAVAILABLE
      mockCreate.mockRejectedValue(err);

      await expect(
        repo.claim('evt_004', 'payment_intent.succeeded'),
      ).rejects.toThrow('Firestore unavailable');
    });

    it('rethrows errors with no code property', async () => {
      // Defensive: an error without err.code is not a duplicate signal.
      mockCreate.mockRejectedValue(new Error('Network blip'));

      await expect(
        repo.claim('evt_005', 'payment_intent.succeeded'),
      ).rejects.toThrow('Network blip');
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

      const [first, second] = await Promise.all([
        repo.claim('evt_race', 'payment_intent.succeeded'),
        repo.claim('evt_race', 'payment_intent.succeeded'),
      ]);

      const winners = [first, second].filter(Boolean);
      expect(winners).toHaveLength(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

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
