jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('firebase-admin/storage', () => ({ getStorage: jest.fn() }));

import { getStorage } from 'firebase-admin/storage';
import { UserRepository } from '../repositories/UserRepository';

describe('UserRepository account media cleanup', () => {
  it('does not sweep the owner Storage prefix during account deletion', async () => {
    const empty = { docs: [], size: 0, empty: true };
    const query: any = {
      where: jest.fn(() => query),
      get: jest.fn().mockResolvedValue(empty),
      doc: jest.fn(() => ({})),
    };
    const tx = { get: jest.fn().mockResolvedValue(empty), set: jest.fn() };
    const repository = new UserRepository();
    (repository as any).db = {
      collection: jest.fn(() => query),
      runTransaction: jest.fn(async (callback: any) => callback(tx)),
    };
    await expect(repository.deleteAccountData('user-1')).resolves.toMatchObject({
      deletedUnsoldProducts: 0,
    });
    expect(getStorage).not.toHaveBeenCalled();
  });
});
