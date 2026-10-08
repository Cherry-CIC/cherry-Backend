import { Timestamp } from 'firebase-admin/firestore';
import { ProductRepository } from '../repositories/ProductRepository';
import { ProductLikeRepository } from '../repositories/ProductLikeRepository';
import { Product } from '../model/Product';

// The injected database must also supply every guard and checkout query.
// A fallback to the default singleton therefore fails these tests.
jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));

type Data = FirebaseFirestore.DocumentData;
type Ref = { id: string; path: string; get: () => Promise<unknown> };
type Snapshot = { id: string; data: () => Data; get: (key: string) => unknown };

const product = (overrides: Data = {}): Data => ({
  name: 'Cotton shirt',
  userId: 'seller',
  number: 1,
  status: 'active',
  likes: 0,
  price: 10,
  donation: 10,
  categoryId: 'shirts',
  charityId: 'charity',
  postageSize: 'small',
  createdAt: Timestamp.fromMillis(1000),
  ...overrides,
});

const database = (initial: Record<string, Data>) => {
  const stored = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: string[] = [];
  const snapshot = (path: string) => ({
    id: path.split('/').pop()!,
    exists: stored.has(path),
    data: () => stored.get(path)!,
    get: (key: string) => stored.get(path)?.[key],
  });
  const ref = (path: string): Ref => ({
    path,
    id: path.split('/').pop()!,
    get: async () => snapshot(path),
  });
  const compare = (left: Snapshot, right: Snapshot): number =>
    (right.data().createdAt?.toMillis() ?? 0) -
      (left.data().createdAt?.toMillis() ?? 0) ||
    (left.id === right.id ? 0 : left.id > right.id ? -1 : 1);
  const query = (
    collection: string,
    filters: [string, string, unknown][] = [],
    after?: Snapshot,
    count = Infinity,
  ): object => ({
    path: collection,
    doc: (id = 'generated') => ref(`${collection}/${id}`),
    where: (field: string, operator: string, value: unknown) =>
      query(collection, [...filters, [field, operator, value]], after, count),
    orderBy: () => query(collection, filters, after, count),
    startAfter: (value: Date | Snapshot, id?: string) =>
      query(
        collection,
        filters,
        value instanceof Date
          ? {
              id: id!,
              data: () => ({ createdAt: Timestamp.fromDate(value) }),
              get: () => undefined,
            }
          : value,
        count,
      ),
    limit: (limit: number) => query(collection, filters, after, limit),
    get: async () => {
      const docs = [...stored.keys()]
        .filter((path) => path.startsWith(`${collection}/`))
        .map(snapshot)
        .filter((doc) =>
          filters.every(([field, operator, value]) => {
            const actual = doc.get(field);
            if (operator === 'in') return (value as unknown[]).includes(actual);
            if (operator === '>=')
              return (actual as number) >= (value as number);
            if (operator === '<=')
              return (actual as number) <= (value as number);
            return actual === value;
          }),
        )
        .sort(compare)
        .filter((doc) => !after || compare(doc, after) > 0)
        .slice(0, count);
      return { docs, empty: docs.length === 0 };
    },
  });
  const db = {
    collection: (name: string) => query(name),
    getAll: async (...refs: Ref[]) => refs.map(({ path }) => snapshot(path)),
    runTransaction: async (work: (transaction: object) => Promise<unknown>) => {
      const pending: (() => void)[] = [];
      const transaction = {
        get: async (reference: Ref) => {
          reads.push(reference.path);
          if (writes.length) throw new Error('Read after write');
          return reference.get();
        },
        create: (reference: Ref, data: Data) => {
          writes.push(reference.path);
          pending.push(() => stored.set(reference.path, data));
        },
        set: (reference: Ref, data: Data) => {
          writes.push(reference.path);
          pending.push(() => stored.set(reference.path, data));
        },
        update: (reference: Ref, data: Data) => {
          writes.push(reference.path);
          pending.push(() =>
            stored.set(reference.path, {
              ...stored.get(reference.path),
              ...data,
            }),
          );
        },
        delete: (reference: Ref) => {
          writes.push(reference.path);
          pending.push(() => stored.delete(reference.path));
        },
      };
      const result = await work(transaction);
      pending.forEach((apply) => apply());
      return result;
    },
  } as unknown as FirebaseFirestore.Firestore;
  return { db, stored, reads, writes };
};

describe('product access during account deletion', () => {
  it.each(['buyer', 'seller'])(
    'rejects favourites if the %s guard exists',
    async (uid) => {
      const source = database({
        'products/listing': product(),
        [`account_deletion_guards/${uid}`]: { blocked: true },
      });
      await expect(
        new ProductLikeRepository(source.db).setLikeStatus(
          'buyer',
          'listing',
          true,
        ),
      ).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_PENDING' });
      expect(source.writes).toEqual([]);
      expect(source.stored.get('products/listing')?.likes).toBe(0);
    },
  );

  it('reads both guards in the same transaction before creating a favourite', async () => {
    const source = database({ 'products/listing': product() });
    await expect(
      new ProductLikeRepository(source.db).setLikeStatus(
        'buyer',
        'listing',
        true,
      ),
    ).resolves.toMatchObject({ liked: true, product: { likes: 1 } });
    expect(source.reads).toEqual(
      expect.arrayContaining([
        'account_deletion_guards/buyer',
        'account_deletion_guards/seller',
      ]),
    );
    expect(source.stored.get('user_likes/buyer_listing')).toMatchObject({
      userId: 'buyer',
      productId: 'listing',
    });
  });

  it('keeps repeated likes idempotent and unlike counts clamped at zero', async () => {
    const liked = database({
      'products/listing': product({ likes: 3 }),
      'user_likes/buyer_listing': { userId: 'buyer', productId: 'listing' },
    });
    await expect(
      new ProductLikeRepository(liked.db).setLikeStatus(
        'buyer',
        'listing',
        true,
      ),
    ).resolves.toMatchObject({ liked: true, product: { likes: 3 } });
    expect(liked.writes).toEqual([]);

    const inconsistent = database({
      'products/listing': product(),
      'user_likes/buyer_listing': { userId: 'buyer', productId: 'listing' },
    });
    await expect(
      new ProductLikeRepository(inconsistent.db).setLikeStatus(
        'buyer',
        'listing',
        false,
      ),
    ).resolves.toMatchObject({ liked: false, product: { likes: 0 } });
    expect(inconsistent.stored.has('user_likes/buyer_listing')).toBe(false);
  });

  it('returns no favourites for a restricted actor', async () => {
    const source = database({ 'account_deletion_guards/buyer': {} });
    await expect(
      new ProductLikeRepository(source.db).getLikedProductsPage('buyer', 20),
    ).resolves.toEqual({ likes: [], hasMore: false });
  });

  it('hides all public listing reads while keeping the paid fulfilment lookup', async () => {
    const source = database({
      'products/listing': product(),
      'account_deletion_guards/seller': {},
    });
    const repository = new ProductRepository(source.db);
    await expect(repository.getById('listing')).resolves.toBeNull();
    await expect(repository.getAll()).resolves.toEqual([]);
    await expect(repository.getByUserId('seller')).resolves.toEqual([]);
    await expect(repository.getProductsByCategory('shirts')).resolves.toEqual(
      [],
    );
    await expect(repository.getProductsByCharity('charity')).resolves.toEqual(
      [],
    );
    await expect(
      repository.getPageByFilters({ userId: 'seller' }, 20),
    ).resolves.toEqual({ items: [], hasMore: false });
    await expect(repository.getForPaidOrder('listing')).resolves.toMatchObject({
      id: 'listing',
      userId: 'seller',
    });
  });

  it('fills pages past guarded owners and preserves the next visible boundary', async () => {
    const source = database({
      'products/z-hidden': product({ userId: 'closed' }),
      'products/y-unlisted': product({ status: 'unlisted' }),
      'products/x-hidden': product({ userId: 'closed' }),
      'products/w-sold': product({ status: 'sold', number: 0 }),
      'products/v-legacy': product({ status: undefined }),
      'account_deletion_guards/closed': {},
    });
    const repository = new ProductRepository(source.db);
    const first = await repository.getPageByFilters({}, 2);
    expect(first.items.map(({ id, status }) => [id, status])).toEqual([
      ['y-unlisted', 'unlisted'],
      ['w-sold', 'sold'],
    ]);
    expect(first.hasMore).toBe(true);
    const last = await repository.getPageByFilters({}, 2, {
      id: 'w-sold',
      createdAt: new Date(1000),
    });
    expect(last.items.map(({ id, status }) => [id, status])).toEqual([
      ['v-legacy', 'active'],
    ]);
    expect(last.hasMore).toBe(false);
  });

  it.each(['create', 'update', 'delete', 'adjustLikes'] as const)(
    'rejects %s after seller deletion acceptance',
    async (method) => {
      const source = database({
        'products/listing': product(),
        'account_deletion_guards/seller': {},
      });
      const repository = new ProductRepository(source.db);
      const operation =
        method === 'create'
          ? repository.create(product() as Product)
          : method === 'update'
            ? repository.update('listing', { name: 'New name' })
            : method === 'delete'
              ? repository.delete('listing')
              : repository.adjustLikes('listing', 1);
      await expect(operation).rejects.toMatchObject({
        code: 'ACCOUNT_DELETION_PENDING',
      });
      expect(source.writes).toEqual([]);
    },
  );

  it('preserves immutable ownership and publication while checkout is unresolved', async () => {
    const source = database({
      'products/listing': product(),
      'account_checkout_contexts/checkout': {
        productId: 'listing',
        state: 'open',
      },
    });
    const repository = new ProductRepository(source.db);
    await expect(
      repository.update('listing', { userId: 'other' }),
    ).rejects.toThrow('Product ownership cannot be changed');
    await expect(
      repository.update('listing', { status: 'unlisted' }),
    ).rejects.toThrow('Product has an unresolved checkout');
    await expect(repository.delete('listing')).rejects.toThrow(
      'Product has an unresolved checkout',
    );
    expect(source.writes).toEqual([]);
    expect(source.reads).toContain('account_checkout_contexts');
  });
});
