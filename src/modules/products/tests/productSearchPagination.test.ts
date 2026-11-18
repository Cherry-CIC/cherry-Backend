import { Timestamp } from 'firebase-admin/firestore';
import { ProductRepository } from '../repositories/ProductRepository';
import { ProductService } from '../services/ProductService';

jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));

interface Listing {
  id: string;
  data: FirebaseFirestore.DocumentData;
}

const listing = (id: string, nanoseconds: number, extra = {}): Listing => ({
  id,
  data: {
    name: 'Red coat', categoryId: 'women', charityId: 'charity',
    size: 'Medium', quality: 'GOOD', number: 1, status: 'active',
    createdAt: new Timestamp(1700000000, nanoseconds),
    ...extra,
  },
});

// Execute the repository's filters and cursors against timestamp-ordered records.
// This catches precision loss that a sequence of pre-canned pages would miss.
const database = (records: Listing[]) => {
  const reads = jest.fn();
  const compare = (left: Listing, right: Listing) =>
    right.data.createdAt.seconds - left.data.createdAt.seconds ||
    right.data.createdAt.nanoseconds - left.data.createdAt.nanoseconds ||
    (left.id === right.id ? 0 : left.id > right.id ? -1 : 1);
  const query = (filters: [string, unknown][] = [], after?: Listing, limit = Infinity): object => ({
    where: (field: string, operator: string, value: unknown) => {
      expect(operator).toBe('==');
      return query([...filters, [field, value]], after, limit);
    },
    orderBy: () => query(filters, after, limit),
    startAfter: (createdAt: Timestamp | Date, id: string) => query(filters, {
      id,
      data: { createdAt: createdAt instanceof Date ? Timestamp.fromDate(createdAt) : createdAt },
    }, limit),
    limit: (count: number) => query(filters, after, count),
    get: async () => {
      reads();
      return {
        docs: [...records]
          .filter((record) => filters.every(([field, value]) => record.data[field] === value))
          .sort(compare)
          .filter((record) => !after || compare(record, after) > 0)
          .slice(0, limit)
          .map((record) => ({ id: record.id, data: () => record.data })),
      };
    },
  });
  const repository = new ProductRepository({
    collection: jest.fn(() => query()),
  } as unknown as FirebaseFirestore.Firestore);
  const relation = { getById: jest.fn().mockResolvedValue(null) } as any;
  return {
    repository,
    reads,
    service: new ProductService(repository, {} as any, relation, relation, relation),
  };
};

describe('Marketplace category search pagination', () => {
  it('retains matches left over in the final scanned batch', async () => {
    const { service } = database([
      listing('first', 9000000),
      listing('miss', 8000000, { name: 'Blue shirt' }),
      listing('second', 7000000),
      listing('third', 6000000),
    ]);
    const query = { categoryId: 'women', search: ' coat ', limit: 2 };
    const first = await service.getPaginatedProductsWithDetails(query);
    expect(first.items.map((item) => item.id)).toEqual(['first', 'second']);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.getPaginatedProductsWithDetails({ ...query, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.id)).toEqual(['third']);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it('preserves sub-millisecond timestamp positions', async () => {
    const { service } = database([
      listing('a', 123100000),
      listing('z', 123099000),
    ]);
    const first = await service.getPaginatedProductsWithDetails({ limit: 1 });
    const second = await service.getPaginatedProductsWithDetails({ limit: 1, cursor: first.nextCursor! });
    expect(first.items.map((item) => item.id)).toEqual(['a']);
    expect(second.items.map((item) => item.id)).toEqual(['z']);
    expect(second.nextCursor).toBeNull();
  });

  it('retains exact timestamp positions between scanned batches with no matches', async () => {
    const { service } = database([
      listing('miss', 123100000, { name: 'Blue shirt' }),
      listing('match', 123099000),
    ]);
    const page = await service.getPaginatedProductsWithDetails({ search: 'coat', limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual(['match']);
  });

  it('uses descending document IDs when creation timestamps are equal', async () => {
    const { service } = database([listing('a', 1000), listing('b', 1000)]);
    const first = await service.getPaginatedProducts({ limit: 1 });
    const second = await service.getPaginatedProducts({ limit: 1, cursor: first.nextCursor! });
    expect(first.items.map((item) => item.id)).toEqual(['b']);
    expect(second.items.map((item) => item.id)).toEqual(['a']);
  });

  it('preserves category, case-insensitive phrase and availability filters across pages', async () => {
    const { service } = database([
      listing('other-category', 9000000, { categoryId: 'men' }),
      listing('hidden', 8000000, { hidden: true }),
      listing('unlisted', 7000000, { status: 'unlisted' }),
      listing('sold', 6000000, { number: 0 }),
      listing('first', 5000000),
      listing('phrase-miss', 4000000, { name: 'Red wool coat' }),
      listing('second', 3000000),
    ]);
    const query = { categoryId: 'women', search: ' RED COAT ', limit: 1 };
    const first = await service.getPaginatedProductsWithDetails(query);
    const second = await service.getPaginatedProductsWithDetails({ ...query, cursor: first.nextCursor! });
    expect(first.items.map((item) => item.id)).toEqual(['first']);
    expect(second.items.map((item) => item.id)).toEqual(['second']);
    expect(second.hasMore).toBe(false);
  });

  it('accepts existing ISO-date cursors and rejects changed category or malformed precision', async () => {
    const { service } = database([listing('first', 9000000), listing('second', 8000000)]);
    const query = { categoryId: 'women', limit: 1 };
    const first = await service.getPaginatedProducts(query);
    const payload = JSON.parse(Buffer.from(first.nextCursor!, 'base64').toString());
    delete payload.createdAtSeconds;
    delete payload.createdAtNanoseconds;
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64');
    const legacy = await service.getPaginatedProducts({ ...query, cursor: encode(payload) });
    expect(legacy.items.map((item) => item.id)).toEqual(['second']);
    await expect(service.getPaginatedProducts({ ...query, categoryId: 'men', cursor: first.nextCursor! }))
      .rejects.toThrow('Invalid cursor');
    await expect(service.getPaginatedProducts({ ...query, cursor: encode({ ...payload, createdAt: 'not-a-date' }) }))
      .rejects.toThrow('Invalid cursor');
    await expect(service.getPaginatedProducts({ ...query, cursor: encode({ ...payload, createdAtSeconds: 1 }) }))
      .rejects.toThrow('Invalid cursor');
    await expect(service.getPaginatedProducts({ ...query, cursor: encode({ ...payload, createdAtSeconds: 1, createdAtNanoseconds: 1000000000 }) }))
      .rejects.toThrow('Invalid cursor');
  });
});
