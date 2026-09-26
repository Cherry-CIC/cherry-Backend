import { Timestamp } from 'firebase-admin/firestore';
import { UserProductRepository } from '../repositories/UserProductRepository';

jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));

interface RecordFixture {
  id: string;
  data: FirebaseFirestore.DocumentData;
}

const fixture = (
  id: string,
  overrides: FirebaseFirestore.DocumentData = {},
): RecordFixture => ({
  id,
  data: {
    userId: 'seller-uid',
    name: 'Blue cotton shirt',
    description: 'A pre-loved cotton shirt in good condition.',
    quality: 'Good',
    product_images: ['https://example.org/listing.jpg'],
    donation: 10,
    price: 10,
    likes: 0,
    number: 1,
    size: 'M',
    postageSize: 'small-parcel-id',
    categoryId: 'shirts-id',
    charityId: 'charity-id',
    status: 'active',
    createdAt: new Timestamp(1700000000, 123456789),
    ...overrides,
  },
});

// This double executes filters, ordering, snapshot cursors and value cursors.
// It never initialises Firebase or accesses real records.
const database = (records: RecordFixture[], ignoreFilters = false) => {
  const where = jest.fn();
  const orderBy = jest.fn();
  const read = jest.fn();
  const compare = (left: RecordFixture, right: RecordFixture): number => {
    const leftTime = left.data.createdAt;
    const rightTime = right.data.createdAt;
    return (
      (rightTime?.seconds ?? 0) - (leftTime?.seconds ?? 0) ||
      (rightTime?.nanoseconds ?? 0) - (leftTime?.nanoseconds ?? 0) ||
      (left.id === right.id ? 0 : left.id > right.id ? -1 : 1)
    );
  };
  const query = (
    filters: [string, unknown][] = [],
    after?: RecordFixture,
    count = Number.POSITIVE_INFINITY,
  ): object => ({
    where: (field: string, operator: string, value: unknown) => {
      where(field, operator, value);
      return query([...filters, [field, value]], after, count);
    },
    orderBy: (field: unknown, direction: string) => {
      orderBy(field, direction);
      return query(filters, after, count);
    },
    startAfter: (
      value: Timestamp | { id: string; data: () => object },
      id?: string,
    ) =>
      query(
        filters,
        value instanceof Timestamp
          ? { id: id!, data: { createdAt: value } }
          : { id: value.id, data: value.data() },
        count,
      ),
    limit: (value: number) => query(filters, after, value),
    get: async () => {
      read(count);
      return {
        docs: records
          .filter(
            (record) =>
              ignoreFilters ||
              filters.every(([field, value]) => record.data[field] === value),
          )
          .sort(compare)
          .filter((record) => !after || compare(record, after) > 0)
          .slice(0, count)
          .map((record) => ({ id: record.id, data: () => record.data })),
      };
    },
  });
  const collection = jest.fn(() => query());
  return {
    db: { collection } as unknown as FirebaseFirestore.Firestore,
    collection,
    where,
    orderBy,
    read,
  };
};

describe('UserProductRepository', () => {
  it.each([' padded ', 'control\u0085id'])(
    'excludes document IDs that cannot safely round-trip through detail URLs and cursors',
    async (id) => {
      const source = database([fixture(id)]);
      await expect(
        new UserProductRepository(source.db).getPage('seller-uid', 1),
      ).resolves.toEqual({ products: [], nextPosition: null });
    },
  );

  it('matches the Flutter product contract through an explicit safe allowlist', async () => {
    const privateData = {
      email: 'private@example.org',
      phone: 'private',
      phoneNumber: 'private',
      address: 'private',
      firebaseUid: 'private',
      tokens: 'private',
      authentication: {},
      providerData: [],
      orders: [],
      shipments: [],
      payment: {},
    };
    const source = database([
      fixture('listing-id', {
        ...privateData,
        user: privateData,
        category: { name: 'Shirts', ...privateData },
        charity: { name: 'Test charity', ...privateData },
        securityFee: 999,
      }),
    ]);
    const result = await new UserProductRepository(source.db).getPage(
      'seller-uid',
      20,
    );

    expect(result).toEqual({
      products: [
        {
          id: 'listing-id',
          userId: 'seller-uid',
          name: 'Blue cotton shirt',
          description: 'A pre-loved cotton shirt in good condition.',
          quality: 'Good',
          product_images: ['https://example.org/listing.jpg'],
          donation: 10,
          price: 10,
          securityFee: 1,
          likes: 0,
          number: 1,
          size: 'M',
          postageSize: 'small-parcel-id',
          categoryId: 'shirts-id',
          charityId: 'charity-id',
          status: 'active',
        },
      ],
      nextPosition: null,
    });
    const inspectKeys = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value)) {
        expect(Object.keys(privateData)).not.toContain(key);
        inspectKeys(nested);
      }
    };
    inspectKeys(result);
    expect(source.collection).toHaveBeenCalledWith('products');
    expect(source.where.mock.calls).toEqual([
      ['userId', '==', 'seller-uid'],
    ]);
    expect(source.orderBy.mock.calls[0]).toEqual(['createdAt', 'desc']);
    expect(source.orderBy.mock.calls[1][1]).toBe('desc');
  });

  it('preserves stored money and uses the existing pence-based security fee', async () => {
    const source = database([
      fixture('listing', { price: 12.35, donation: 10 }),
    ]);
    const result = await new UserProductRepository(source.db).getPage(
      'seller-uid',
      1,
    );
    expect(result.products[0]).toMatchObject({
      price: 12.35,
      donation: 10,
      securityFee: 1.24,
    });
  });

  it('defensively rejects wrong owners, unavailable states and invalid stock', async () => {
    const source = database(
      [
        fixture('available'),
        fixture('wrong-owner', { userId: 'another-seller' }),
        fixture('anonymised', { userId: 'deleted_user' }),
        ...['unlisted', 'sold', 'deleted', 'removed', 'draft', 'unknown'].map(
          (status) => fixture(status, { status }),
        ),
        ...[0, -1, 1.5, '1', null, undefined, Infinity].map((number, index) =>
          fixture(`stock-${index}`, { number }),
        ),
      ],
      true,
    );
    const result = await new UserProductRepository(source.db).getPage(
      'seller-uid',
      20,
    );
    expect(result.products.map(({ id }) => id)).toEqual(['available']);
    expect(result.nextPosition).toBeNull();
  });

  it.each([
    { visibility: 'private' },
    { visibility: 'unknown' },
    { visibility: null },
    { moderationStatus: 'pending' },
    { moderationStatus: 'hidden' },
    { moderationStatus: 'unknown' },
    { moderationStatus: null },
    { publicationStatus: 'draft' },
    { publicationStatus: 'unknown' },
    { moderation: { status: 'approved' } },
    { publication: 'unknown' },
    { deleted: true },
    { isDeleted: true },
    { removed: true },
    { isRemoved: true },
    { hidden: true },
    { isHidden: true },
    { moderationHidden: true },
    { deletedAt: new Timestamp(10, 0) },
    { removedAt: new Timestamp(10, 0) },
    { hiddenAt: new Timestamp(10, 0) },
    { hidden: 'false' },
  ])('excludes explicit non-displayable or unknown state %j', async (state) => {
    const source = database([fixture('excluded', state)]);
    await expect(
      new UserProductRepository(source.db).getPage('seller-uid', 20),
    ).resolves.toEqual({ products: [], nextPosition: null });
  });

  it('accepts the documented legacy rule and recognised safe states', async () => {
    const source = database([
      fixture('legacy', { status: undefined }),
      fixture('explicit', {
        visibility: 'public',
        moderationStatus: 'approved',
        publicationStatus: 'published',
        isDeleted: false,
        hidden: false,
        removedAt: null,
      }),
    ]);
    const result = await new UserProductRepository(source.db).getPage(
      'seller-uid',
      20,
    );
    expect(result.products.map(({ id }) => id)).toEqual(['legacy', 'explicit']);
  });

  it('returns an empty page for no user products and never queries anonymised owners', async () => {
    const source = database([fixture('sold', { status: 'sold' })]);
    const repository = new UserProductRepository(source.db);
    await expect(repository.getPage('seller-uid', 20)).resolves.toEqual({
      products: [],
      nextPosition: null,
    });
    source.collection.mockClear();
    await expect(repository.getPage('deleted_user', 20)).resolves.toEqual(
      {
        products: [],
        nextPosition: null,
      },
    );
    expect(source.collection).not.toHaveBeenCalled();
  });

  it.each([
    { name: '' },
    { quality: null },
    { size: ' ' },
    { postageSize: '../private' },
    { description: {} },
    { product_images: 'https://example.org/listing.jpg' },
    { price: undefined },
    { price: '10' },
    { price: Infinity },
    { price: Number.MAX_VALUE },
    { donation: -1 },
    { likes: -1 },
    { likes: 0.1 },
    { createdAt: '2026-01-01' },
    { createdAt: { seconds: 1, nanoseconds: 0 } },
  ])('excludes malformed contract data %j', async (data) => {
    const source = database([fixture('invalid', data)]);
    await expect(
      new UserProductRepository(source.db).getPage('seller-uid', 20),
    ).resolves.toEqual({ products: [], nextPosition: null });
  });

  it('supplies safe legacy defaults and removes unsafe images and relation IDs', async () => {
    const source = database([
      fixture('listing', {
        description: undefined,
        likes: undefined,
        categoryId: { name: 'private relation' },
        charityId: '../private',
        product_images: [
          'https://example.org/safe.jpg',
          'http://example.org/safe.jpg',
          'HTTPS://EXAMPLE.ORG/normalised.jpg',
          'https:example.org/absolute.jpg',
          'https://username:secret@example.org/private.jpg',
          'data:image/png;base64,secret',
          'file:///private.jpg',
          'not a URL',
          { token: 'private' },
        ],
      }),
    ]);
    const result = await new UserProductRepository(source.db).getPage(
      'seller-uid',
      20,
    );
    expect(result.products[0]).toMatchObject({
      description: '',
      likes: 0,
      product_images: [
        'https://example.org/safe.jpg',
        'http://example.org/safe.jpg',
        'https://example.org/normalised.jpg',
        'https://example.org/absolute.jpg',
      ],
    });
    expect(result.products[0]).not.toHaveProperty('categoryId');
    expect(result.products[0]).not.toHaveProperty('charityId');
  });

  it('keeps timestamp nanoseconds and descending document IDs stable across pages', async () => {
    const source = database([
      fixture('a', { createdAt: new Timestamp(100, 123456789) }),
      fixture('z', { createdAt: new Timestamp(100, 123456789) }),
      fixture('older', { createdAt: new Timestamp(100, 123456788) }),
      fixture('newer', { createdAt: new Timestamp(100, 123456790) }),
    ]);
    const repository = new UserProductRepository(source.db);
    const first = await repository.getPage('seller-uid', 2);
    expect(first.products.map(({ id }) => id)).toEqual(['newer', 'z']);
    expect(first.nextPosition).toEqual({
      seconds: 100,
      nanoseconds: 123456789,
      id: 'z',
    });
    const second = await repository.getPage(
      'seller-uid',
      2,
      first.nextPosition!,
    );
    expect(second.products.map(({ id }) => id)).toEqual(['a', 'older']);
    expect(second.nextPosition).toBeNull();
    expect(
      new Set([...first.products, ...second.products].map(({ id }) => id)).size,
    ).toBe(4);
  });

  it('scans excluded source pages before determining eligible page boundaries', async () => {
    const source = database([
      fixture('first', { createdAt: new Timestamp(1000, 0) }),
      ...Array.from({ length: 225 }, (_, index) =>
        fixture(`excluded-${index}`, {
          createdAt: new Timestamp(900 - index, 0),
          number: 0,
        }),
      ),
      fixture('second', { createdAt: new Timestamp(600, 0) }),
      fixture('third', { createdAt: new Timestamp(500, 0) }),
      fixture('trailing-hidden', {
        createdAt: new Timestamp(400, 0),
        moderationStatus: 'hidden',
      }),
    ]);
    const repository = new UserProductRepository(source.db);
    const first = await repository.getPage('seller-uid', 1);
    expect(source.read.mock.calls.map(([limit]) => limit)).toEqual([
      2, 100, 100, 100,
    ]);
    expect(first.products.map(({ id }) => id)).toEqual(['first']);
    expect(first.nextPosition?.id).toBe('first');
    const second = await repository.getPage(
      'seller-uid',
      1,
      first.nextPosition!,
    );
    expect(second.products.map(({ id }) => id)).toEqual(['second']);
    expect(second.nextPosition?.id).toBe('second');
    const third = await repository.getPage(
      'seller-uid',
      1,
      second.nextPosition!,
    );
    expect(third.products.map(({ id }) => id)).toEqual(['third']);
    expect(third.nextPosition).toBeNull();
  });

  it('fills minimum and maximum pages and only returns a cursor when another user product exists', async () => {
    const source = database(
      Array.from({ length: 51 }, (_, index) =>
        fixture(`item-${index.toString().padStart(2, '0')}`),
      ),
    );
    const repository = new UserProductRepository(source.db);
    const first = await repository.getPage('seller-uid', 50);
    expect(first.products).toHaveLength(50);
    expect(first.nextPosition?.id).toBe(first.products[49].id);
    const last = await repository.getPage(
      'seller-uid',
      1,
      first.nextPosition!,
    );
    expect(last.products).toHaveLength(1);
    expect(last.nextPosition).toBeNull();
  });

  it.each([1, 20, 50])(
    'reads only the requested page and lookahead when listings are eligible (limit=%i)',
    async (limit) => {
      const source = database(
        Array.from({ length: 200 }, (_, index) =>
          fixture(`item-${index.toString().padStart(3, '0')}`),
        ),
      );
      const page = await new UserProductRepository(source.db).getPage(
        'seller-uid',
        limit,
      );
      expect(source.read.mock.calls).toEqual([[limit + 1]]);
      expect(page.products).toHaveLength(limit);
      expect(page.nextPosition?.id).toBe(page.products[limit - 1].id);
    },
  );

  it('fails operationally at the scan budget rather than returning misleading metadata', async () => {
    const source = database(
      Array.from({ length: 5001 }, (_, index) =>
        fixture(`item-${index.toString().padStart(4, '0')}`, { number: 0 }),
      ),
    );
    await expect(
      new UserProductRepository(source.db).getPage('seller-uid', 20),
    ).rejects.toThrow('User product scan limit exceeded');
    expect(source.read).toHaveBeenCalledTimes(51);
    expect(
      source.read.mock.calls.reduce((total, [limit]) => total + limit, 0),
    ).toBe(5000);
  });

  it('preserves database failures for the service to handle as retryable errors', async () => {
    const failure = new Error('Firestore unavailable');
    const db = {
      collection: () => {
        throw failure;
      },
    } as unknown as FirebaseFirestore.Firestore;
    await expect(
      new UserProductRepository(db).getPage('seller-uid', 20),
    ).rejects.toBe(failure);
  });
});
