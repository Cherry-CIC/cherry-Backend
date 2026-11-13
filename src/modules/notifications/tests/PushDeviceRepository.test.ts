jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));
import { createHash } from 'crypto';
import { PushDeviceLimitError, PushDeviceRepository } from '../repositories/PushDeviceRepository';

describe('PushDeviceRepository', () => {
  let data: Map<string, any>;
  let repository: PushDeviceRepository;
  const id = (token: string) => createHash('sha256').update(token).digest('hex');
  beforeEach(() => {
    data = new Map();
    const db: any = {
      collection: () => ({
        doc: (key: string) => ({ key }),
        where: (_field: string, _operator: string, userId: string) => ({ limit: (limit: number) => ({ userId, limit }) }),
      }),
      runTransaction: async (fn: any) => fn({
        get: async (ref: any) => ref.key
          ? { data: () => data.get(ref.key) }
          : (() => {
            const matches = [...data.entries()].filter(([, value]) => value.userId === ref.userId).slice(0, ref.limit);
            return { size: matches.length, docs: matches.map(([key, value]) => ({ ref: { key }, data: () => value })) };
          })(),
        set: (ref: any, value: any) => data.set(ref.key, value),
        delete: (ref: any) => data.delete(ref.key),
      }),
    };
    repository = new PushDeviceRepository(db);
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
});
