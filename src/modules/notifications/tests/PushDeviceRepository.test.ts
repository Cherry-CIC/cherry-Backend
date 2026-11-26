jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));
import { createHash } from 'crypto';
import { PushDeviceLimitError, PushDeviceRepository } from '../repositories/PushDeviceRepository';

describe('PushDeviceRepository', () => {
  let data: Map<string, any>;
  let repository: PushDeviceRepository;
  let profileExists: boolean;
  const id = (token: string) => createHash('sha256').update(token).digest('hex');
  beforeEach(() => {
    data = new Map();
    profileExists = true;
    const snapshot = (key: string) => ({
      id: key,
      ref: { key },
      data: () => data.get(key),
      get: (field: string) => data.get(key)?.[field],
    });
    const query = (userId: string, limit: number) => {
      const docs = [...data.keys()]
        .filter(key => data.get(key).userId === userId)
        .slice(0, limit)
        .map(snapshot);
      return { size: docs.length, docs };
    };
    const db: any = {
      collection: (name: string) => ({
        doc: (key: string) => ({ key, get: async () => snapshot(key) }),
        where: (_field: string, _operator: string, userId: string) => ({
          limit: (limit: number) => ({ get: async () => name === 'users' ? { empty: !profileExists } : query(userId, limit) }),
        }),
      }),
      runTransaction: async (callback: any) => callback({
        get: (ref: any) => ref.get(),
        set: (ref: any, value: any) => data.set(ref.key, value),
        delete: (ref: any) => data.delete(ref.key),
      }),
    };
    repository = new PushDeviceRepository(db);
  });
  it('rejects registration after profile deletion', async () => {
    profileExists = false;
    await expect(repository.register('buyer', 'token', 'android')).rejects.toThrow();
    expect(data.size).toBe(0);
  });
  it('registers one record per token and refreshes its timestamp', async () => {
    await repository.register('buyer', 'token', 'ios');
    const initial = data.get(id('token'));
    expect(initial).toEqual({ userId: 'buyer', token: 'token', platform: 'ios', updatedAt: expect.any(Date) });
    await repository.register('buyer', 'token', 'android');
    expect(data.size).toBe(1);
    expect(data.get(id('token')).platform).toBe('android');
  });
  it('transfers ownership and ignores a delayed logout from the previous owner', async () => {
    await repository.register('first', 'token', 'ios');
    await repository.register('second', 'token', 'ios');
    await repository.remove('first', 'token');
    expect(data.get(id('token')).userId).toBe('second');
    await repository.remove('second', 'token');
    expect(data.size).toBe(0);
  });
  it('makes repeated or unknown cleanup harmless', async () => {
    await repository.remove('buyer', 'missing');
    await repository.register('buyer', 'token', 'ios');
    await repository.remove('buyer', 'token');
    await repository.remove('buyer', 'token');
    expect(data.size).toBe(0);
  });
  it('caps registrations but allows existing devices to refresh', async () => {
    for (let i = 0; i < 20; i++) await repository.register('buyer', `token-${i}`, 'ios');
    await expect(repository.register('buyer', 'extra', 'ios')).rejects.toBeInstanceOf(PushDeviceLimitError);
    await expect(repository.register('buyer', 'token-0', 'ios')).resolves.toBeUndefined();
    expect(data.size).toBe(20);
  });
  it('prunes stale registrations so an abandoned device limit cannot block a new phone', async () => {
    for (let i = 0; i < 20; i++) {
      data.set(id(`old-${i}`), { userId: 'buyer', token: `old-${i}`, platform: 'ios', updatedAt: new Date(0) });
    }
    data.set(id('other-buyer'), { userId: 'other', token: 'other-buyer', updatedAt: new Date(0) });
    await repository.register('buyer', 'new-phone', 'android');
    expect(data.size).toBe(2);
    expect(data.get(id('new-phone')).userId).toBe('buyer');
    expect(data.has(id('other-buyer'))).toBe(true);
  });

  it('only lists active registrations for this buyer and rechecks ownership before sending', async () => {
    await repository.register('buyer', 'mine', 'ios');
    await repository.register('buyer', 'old', 'ios');
    await repository.register('other', 'theirs', 'android');
    data.get(id('old')).updatedAt = new Date(0);
    const [device] = await repository.listActive('buyer');
    expect(await repository.listActive('buyer')).toEqual([{ id: id('mine'), token: 'mine' }]);
    expect(await repository.isCurrent('buyer', device)).toBe(true);
    await repository.register('other', 'mine', 'ios');
    expect(await repository.isCurrent('buyer', device)).toBe(false);
    expect(await repository.isCurrent('other', device)).toBe(true);
  });
});
