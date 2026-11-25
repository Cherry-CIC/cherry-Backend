jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {},
}));

import { CharityBlockRepository } from '../repositories/CharityBlockRepository';

describe('CharityBlockRepository', () => {
  it('uses collision-free document IDs for viewer and charity pairs', async () => {
    const refs: string[] = [];
    const db = {
      collection: jest.fn().mockReturnValue({
        doc: jest.fn((id: string) => {
          refs.push(id);
          return {
            set: jest.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };
    const repository = new CharityBlockRepository(db as any);

    await repository.block('a_', 'b');
    await repository.block('a', '_b');

    expect(refs).toHaveLength(2);
    expect(refs[0]).not.toBe(refs[1]);
    expect(refs.every((id) => !id.includes('/'))).toBe(true);
  });

  it('checks a specific charity block without listing all blocked charities', async () => {
    const get = jest.fn().mockResolvedValue({ exists: true });
    const doc = jest.fn().mockReturnValue({ get });
    const where = jest.fn();
    const db = {
      collection: jest.fn().mockReturnValue({ doc, where }),
    };
    const repository = new CharityBlockRepository(db as any);

    await expect(repository.isBlocked('viewer', 'charity-1')).resolves.toBe(
      true,
    );

    expect(doc).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(where).not.toHaveBeenCalled();
  });

  it('unblocks a charity by deleting its deterministic block document', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const doc = jest.fn().mockReturnValue({ delete: del });
    const db = {
      collection: jest.fn().mockReturnValue({ doc }),
    };
    const repository = new CharityBlockRepository(db as any);

    await repository.unblock('viewer', 'charity-1');

    expect(doc).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('lists blocked charities and returns a deduplicated ID set', async () => {
    const get = jest.fn().mockResolvedValue({
      docs: [
        {
          id: 'doc-1',
          data: () => ({
            blockerId: 'viewer',
            blockedCharityId: 'charity-1',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          }),
        },
        {
          id: 'doc-2',
          data: () => ({
            blockerId: 'viewer',
            blockedCharityId: 'charity-2',
            createdAt: new Date('2026-01-02T00:00:00Z'),
          }),
        },
      ],
    });
    const where = jest.fn().mockReturnValue({ get });
    const db = {
      collection: jest.fn().mockReturnValue({ where }),
    };
    const repository = new CharityBlockRepository(db as any);

    const ids = await repository.getBlockedCharityIds('viewer');

    expect(where).toHaveBeenCalledWith('blockerId', '==', 'viewer');
    expect(Array.from(ids)).toEqual(['charity-1', 'charity-2']);
  });
});
