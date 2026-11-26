const mockDb = { collection: jest.fn(), runTransaction: jest.fn() };
jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: mockDb }));

import { UserRepository } from '../repositories/UserRepository';

describe('UserRepository.deleteAccountData', () => {
  it('removes all owned push records and preserves a device transferred during deletion', async () => {
    const records = new Map<string, Record<string, string>>([
      ['pushDevices/owned', { userId: 'buyer' }],
      ['pushDevices/shared', { userId: 'buyer' }],
      ['lockerPushReceipts/other', { buyerId: 'other' }],
    ]);
    for (let i = 0; i < 451; i++) {
      records.set('lockerPushReceipts/' + i, { buyerId: 'buyer' });
    }

    type Query = { collection: string; field: string; uid: string; limit: number };
    mockDb.collection.mockImplementation((collection: string) => ({
      where: (field: string, operator: string, uid: string) => {
        expect(operator).toBe('==');
        return {
          // This buyer's profile and commerce data have already been removed.
          get: async () => ({ docs: [], size: 0, empty: true }),
          limit: (limit: number): Query => ({ collection, field, uid, limit }),
        };
      },
    }));
    mockDb.runTransaction.mockImplementation(async callback => {
      const pendingDeletes: string[] = [];
      const transaction = {
        get: async (query: Query) => {
          const docs = [...records.entries()]
            .filter(([path, data]) => path.startsWith(query.collection + '/') && data[query.field] === query.uid)
            .slice(0, query.limit)
            .map(([path]) => ({ ref: path }));
          return { docs, size: docs.length };
        },
        delete: (path: string) => pendingDeletes.push(path),
      };
      let result = await callback(transaction);
      if (pendingDeletes.includes('pushDevices/shared')) {
        // Firestore discards writes and retries a transaction on a conflicting transfer.
        records.set('pushDevices/shared', { userId: 'new-owner' });
        pendingDeletes.length = 0;
        result = await callback(transaction);
      }
      for (const path of pendingDeletes) records.delete(path);
      return result;
    });

    const repository = new UserRepository({ getFiles: async () => [[]] });
    await repository.deleteAccountData('buyer');
    await repository.deleteAccountData('buyer');

    expect([...records.entries()]).toEqual([
      ['pushDevices/shared', { userId: 'new-owner' }],
      ['lockerPushReceipts/other', { buyerId: 'other' }],
    ]);
  });
});
