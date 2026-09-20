import type { Auth, UserRecord } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {},
  admin: { auth: jest.fn() },
}));

import { PublicUserRepository } from '../repositories/PublicUserRepository';

const UID = 'seller-firebase-uid';
type Fixture = { documentId: string; fields: Record<string, unknown> };

const fixture = (
  documentId: string,
  fields: Record<string, unknown>,
): Fixture => ({ documentId, fields });

const createRepository = (
  canonical?: Record<string, unknown>,
  legacy: Fixture[] = [],
) => {
  const getUser = jest
    .fn<Promise<UserRecord>, [string]>()
    .mockResolvedValue({ uid: UID, disabled: false } as UserRecord);
  const doc = jest.fn().mockReturnValue({ id: UID });
  const queryGet = jest.fn().mockResolvedValue({
    size: legacy.length,
    docs: legacy.map((record) => ({
      id: record.documentId,
      data: () => record.fields,
    })),
  });
  const query = {
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: queryGet,
    doc,
  };
  const collection = jest.fn().mockReturnValue(query);
  const getAll = jest.fn().mockResolvedValue([
    {
      exists: canonical !== undefined,
      data: () => canonical,
    },
  ]);
  const db = { collection, getAll } as unknown as Firestore;
  const auth = { getUser } as Pick<Auth, 'getUser'>;
  return {
    repository: new PublicUserRepository(db, auth),
    getUser,
    collection,
    getAll,
    queryGet,
    query,
    doc,
  };
};

describe('PublicUserRepository', () => {
  it('reads the canonical UID document and returns only the public allowlist', async () => {
    const { repository, getUser, doc, getAll, query } = createRepository({
      id: UID,
      firebaseUid: UID,
      username: '  Alex  ',
      profileImageUrl: 'https://example.org/avatar.jpg',
      displayName: 'Private full name',
      email: 'private@example.org',
      phone: 'private',
      phoneNumber: 'private',
      address: { fullName: 'private', postcode: 'private' },
      providerData: [{ email: 'private@example.org' }],
      tokens: { idToken: 'private' },
      accountSettings: { private: true },
      orders: [{ paymentData: 'private' }],
      shipments: [{ address: 'private' }],
      moderationNotes: 'private',
    });

    await expect(repository.getByFirebaseUid(UID)).resolves.toEqual({
      id: UID,
      username: 'Alex',
      profileImageUrl: 'https://example.org/avatar.jpg',
    });
    expect(getUser).toHaveBeenCalledWith(UID);
    expect(doc).toHaveBeenCalledWith(UID);
    expect(getAll).toHaveBeenCalledWith(
      { id: UID },
      {
        fieldMask: [
          'id',
          'firebaseUid',
          'username',
          'profileImageUrl',
          'photoURL',
          'photoUrl',
        ],
      },
    );
    expect(query.where).toHaveBeenCalledWith('id', '==', UID);
    expect(query.select).toHaveBeenCalledWith(
      'id',
      'firebaseUid',
      'username',
      'profileImageUrl',
      'photoURL',
      'photoUrl',
    );
    expect(query.limit).toHaveBeenCalledWith(21);
  });

  it('resolves generated backend document IDs using their stored Firebase UID', async () => {
    const { repository } = createRepository(undefined, [
      fixture('generated-document', {
        id: UID,
        username: 'Robin',
        photoURL: 'https://example.org/legacy.jpg',
      }),
    ]);
    await expect(repository.getByFirebaseUid(UID)).resolves.toEqual({
      id: UID,
      username: 'Robin',
      profileImageUrl: 'https://example.org/legacy.jpg',
    });
  });

  it('prioritises canonical username and image over linked legacy values', async () => {
    const { repository } = createRepository(
      { username: 'Canonical', photoUrl: 'https://example.org/canonical.jpg' },
      [
        fixture('backend-document', {
          id: UID,
          username: 'Legacy',
          profileImageUrl: 'https://example.org/legacy.jpg',
        }),
        fixture(UID, { id: UID, username: 'Canonical' }),
      ],
    );
    await expect(repository.getByFirebaseUid(UID)).resolves.toEqual({
      id: UID,
      username: 'Canonical',
      profileImageUrl: 'https://example.org/canonical.jpg',
    });
  });

  it('fills missing canonical public values from an unambiguous legacy record', async () => {
    const { repository } = createRepository({ username: '  ' }, [
      fixture('generated-document', {
        id: UID,
        username: ' Legacy ',
        photoUrl: 'http://example.org/legacy.jpg',
      }),
    ]);
    await expect(repository.getByFirebaseUid(UID)).resolves.toEqual({
      id: UID,
      username: 'Legacy',
      profileImageUrl: 'http://example.org/legacy.jpg',
    });
  });

  it.each([
    { username: ' ', email: 'private@example.org' },
    {
      displayName: 'Private full name',
      firstname: 'Private provider full name',
    },
    { username: { email: 'private@example.org' } },
    {},
  ])(
    'uses a neutral name when no chosen username exists: %j',
    async (fields) => {
      const { repository } = createRepository(fields);
      await expect(repository.getByFirebaseUid(UID)).resolves.toEqual({
        id: UID,
        username: 'User',
        profileImageUrl: null,
      });
    },
  );

  it('does not use backend private names or email as a username fallback', async () => {
    const { repository } = createRepository(undefined, [
      fixture('generated-document', {
        id: UID,
        username: '',
        displayName: 'Private full name',
        firstname: 'Private first name',
        email: 'private@example.org',
      }),
    ]);
    expect(await repository.getByFirebaseUid(UID)).toEqual({
      id: UID,
      username: 'User',
      profileImageUrl: null,
    });
  });

  it.each([
    [
      {
        profileImageUrl: 'https://example.org/first',
        photoURL: 'https://example.org/second',
        photoUrl: 'https://example.org/third',
      },
      'https://example.org/first',
    ],
    [
      {
        profileImageUrl: 'invalid',
        photoURL: 'https://example.org/second',
        photoUrl: 'https://example.org/third',
      },
      'https://example.org/second',
    ],
    [{ photoUrl: '  http://example.org/third  ' }, 'http://example.org/third'],
    [{ profileImageUrl: 'javascript:alert(1)' }, null],
    [{ profileImageUrl: 'data:image/png;base64,private' }, null],
    [{ profileImageUrl: 'https://user:password@example.org/private' }, null],
    [{ profileImageUrl: '//example.org/avatar' }, null],
    [{ profileImageUrl: 'https://' }, null],
    [{ profileImageUrl: { url: 'https://example.org/private' } }, null],
  ])(
    'validates avatar aliases and their precedence: %j',
    async (fields, expected) => {
      const { repository } = createRepository({ username: 'Alex', ...fields });
      expect((await repository.getByFirebaseUid(UID))?.profileImageUrl).toBe(
        expected,
      );
    },
  );

  it.each([false, true])(
    'resolves consistent duplicates independently of ordering (%s)',
    async (reverse) => {
      const records = [
        fixture('one', {
          id: UID,
          username: ' Alex ',
          photoURL: 'https://example.org/avatar',
        }),
        fixture('two', {
          id: UID,
          username: 'Alex',
          profileImageUrl: 'https://example.org/avatar',
        }),
        fixture('three', { id: UID, email: 'private@example.org' }),
      ];
      const { repository } = createRepository(
        undefined,
        reverse ? records.reverse() : records,
      );
      await expect(repository.getByFirebaseUid(UID)).resolves.toEqual({
        id: UID,
        username: 'Alex',
        profileImageUrl: 'https://example.org/avatar',
      });
    },
  );

  it.each([false, true])(
    'rejects conflicting duplicate names even with a canonical username (%s)',
    async (reverse) => {
      const records = [
        fixture('one', { id: UID, username: 'Alex' }),
        fixture('two', { id: UID, username: 'Robin' }),
      ];
      const { repository } = createRepository(
        { username: 'Canonical' },
        reverse ? records.reverse() : records,
      );
      await expect(repository.getByFirebaseUid(UID)).resolves.toBeNull();
    },
  );

  it('rejects conflicting duplicate avatar values', async () => {
    const { repository } = createRepository(undefined, [
      fixture('one', { id: UID, photoURL: 'https://example.org/one' }),
      fixture('two', { id: UID, photoUrl: 'https://example.org/two' }),
    ]);
    await expect(repository.getByFirebaseUid(UID)).resolves.toBeNull();
  });

  it('rejects an excessive number of linked records instead of choosing a subset', async () => {
    const { repository } = createRepository(
      { username: 'Canonical' },
      Array.from({ length: 21 }, (_, index) =>
        fixture(String(index), { id: UID, username: 'Alex' }),
      ),
    );
    await expect(repository.getByFirebaseUid(UID)).resolves.toBeNull();
  });

  it.each([
    { id: 'another-uid' },
    { firebaseUid: 'another-uid' },
    { id: null },
  ])('rejects canonical identity conflicts: %j', async (identity) => {
    const { repository } = createRepository({ username: 'Alex', ...identity });
    await expect(repository.getByFirebaseUid(UID)).resolves.toBeNull();
  });

  it('rejects a contradictory UID field on a linked backend record', async () => {
    const { repository } = createRepository(undefined, [
      fixture('generated-document', {
        id: UID,
        firebaseUid: 'another-uid',
        username: 'Alex',
      }),
    ]);
    await expect(repository.getByFirebaseUid(UID)).resolves.toBeNull();
  });

  it('returns unavailable when no Firestore profile exists', async () => {
    const { repository } = createRepository();
    await expect(repository.getByFirebaseUid(UID)).resolves.toBeNull();
  });

  it.each(['auth/user-not-found', 'auth/user-disabled'])(
    'returns unavailable for %s without reading leftover profiles',
    async (code) => {
      const { repository, getUser, collection } = createRepository({
        username: 'Alex',
      });
      getUser.mockRejectedValueOnce({ code });
      await expect(repository.getByFirebaseUid(UID)).resolves.toBeNull();
      expect(collection).not.toHaveBeenCalled();
    },
  );

  it('returns unavailable for disabled Authentication accounts without reading profiles', async () => {
    const { repository, getUser, collection } = createRepository({
      username: 'Alex',
    });
    getUser.mockResolvedValueOnce({ uid: UID, disabled: true } as UserRecord);
    await expect(repository.getByFirebaseUid(UID)).resolves.toBeNull();
    expect(collection).not.toHaveBeenCalled();
  });

  it.each(['', 'deleted_user'])(
    'rejects anonymised or empty identities before querying (%s)',
    async (uid) => {
      const { repository, getUser, collection } = createRepository({
        username: 'Alex',
      });
      await expect(repository.getByFirebaseUid(uid)).resolves.toBeNull();
      expect(getUser).not.toHaveBeenCalled();
      expect(collection).not.toHaveBeenCalled();
    },
  );

  it('preserves operational Authentication failures for retryable handling', async () => {
    const { repository, getUser, collection } = createRepository({
      username: 'Alex',
    });
    const error = Object.assign(new Error('private backend detail'), {
      code: 'auth/internal-error',
    });
    getUser.mockRejectedValueOnce(error);
    await expect(repository.getByFirebaseUid(UID)).rejects.toBe(error);
    expect(collection).not.toHaveBeenCalled();
  });

  it.each(['getAll', 'queryGet'] as const)(
    'preserves operational Firestore failures from %s',
    async (operation) => {
      const dependencies = createRepository({ username: 'Alex' });
      const error = new Error('private backend detail');
      dependencies[operation].mockRejectedValueOnce(error);
      await expect(dependencies.repository.getByFirebaseUid(UID)).rejects.toBe(
        error,
      );
    },
  );
});
