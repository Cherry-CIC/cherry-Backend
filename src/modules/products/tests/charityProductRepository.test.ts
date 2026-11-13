import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { ProductRepository } from '../repositories/ProductRepository';
import { CharityProfileService } from '../../charities/services/CharityProfileService';

jest.mock('../../../shared/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('../../charities/repositories/CharityRepository', () => ({
  CharityRepository: jest.fn(),
}));
jest.mock('../../categories/repositories/CategoryRepository', () => ({
  CategoryRepository: jest.fn(),
}));
jest.mock('../../postage-sizes/repositories/PostageSizeRepository', () => ({
  PostageSizeRepository: jest.fn(),
}));
jest.mock('../../blocks/repositories/CharityBlockRepository', () => ({
  CharityBlockRepository: jest.fn(),
}));

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
    name: `Item ${id}`,
    description: 'Pre-loved item',
    quality: 'Good',
    product_images: ['https://example.org/listing.jpg'],
    donation: 10,
    price: 10,
    likes: 0,
    number: 1,
    size: 'M',
    postageSize: 'post-1',
    categoryId: 'cat-1',
    charityId: 'dogs-trust',
    status: 'active',
    createdAt: new Timestamp(1700000000, 123456789),
    ...overrides,
  },
});

const createFirestoreDouble = (getRecords: () => RecordFixture[]) => {
  const where = jest.fn();
  const orderBy = jest.fn();
  const read = jest.fn();
  const compare = (left: RecordFixture, right: RecordFixture): number => {
    const leftTime = left.data.createdAt as Timestamp | undefined;
    const rightTime = right.data.createdAt as Timestamp | undefined;
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
      value:
        Timestamp | { id: string; data: () => FirebaseFirestore.DocumentData },
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
        docs: getRecords()
          .filter((record) =>
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

describe('ProductRepository.getCharityProductBatch', () => {
  it('queries Firestore by charityId ordered by createdAt desc and documentId desc', async () => {
    const records = [
      fixture('b-older', { createdAt: new Timestamp(1700000100, 100) }),
      fixture('c-same-a', { createdAt: new Timestamp(1700000200, 500000111) }),
      fixture('c-same-b', { createdAt: new Timestamp(1700000200, 500000111) }),
      fixture('a-other', {
        charityId: 'mind',
        createdAt: new Timestamp(1700000300, 0),
      }),
    ];
    const source = createFirestoreDouble(() => records);
    const repo = new ProductRepository(source.db);

    const first = await repo.getCharityProductBatch('dogs-trust', 2);

    expect(source.where).toHaveBeenCalledWith('charityId', '==', 'dogs-trust');
    expect(source.orderBy).toHaveBeenNthCalledWith(1, 'createdAt', 'desc');
    expect(source.orderBy).toHaveBeenNthCalledWith(
      2,
      FieldPath.documentId(),
      'desc',
    );
    expect(source.read).toHaveBeenCalledWith(2);
    expect(first.items.map((item) => item.product.id)).toEqual([
      'c-same-b',
      'c-same-a',
    ]);
    expect(first.exhausted).toBe(false);
    expect(first.items[1].position).toEqual({
      seconds: 1700000200,
      nanoseconds: 500000111,
      id: 'c-same-a',
    });

    const second = await repo.getCharityProductBatch(
      'dogs-trust',
      2,
      first.items[1].position!,
    );
    expect(second.items.map((item) => item.product.id)).toEqual(['b-older']);
    expect(second.exhausted).toBe(true);
  });

  it('paginates accurately with sub-millisecond timestamps even when boundary items disappear', async () => {
    let records = [
      fixture('p-3', { createdAt: new Timestamp(1700000500, 999999999) }),
      fixture('p-2', { createdAt: new Timestamp(1700000500, 123456789) }),
      fixture('p-sold-mid', {
        status: 'sold',
        number: 0,
        createdAt: new Timestamp(1700000500, 123456500),
      }),
      fixture('p-1', { createdAt: new Timestamp(1700000500, 123000100) }),
    ];
    const source = createFirestoreDouble(() => records);
    const repo = new ProductRepository(source.db);
    const charity = {
      id: 'dogs-trust',
      name: 'Dogs Trust',
      image_url: 'https://example.com/dogs.png',
      description: 'Dogs Trust UK',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    };
    const service = new CharityProfileService(
      { getById: jest.fn().mockResolvedValue(charity) },
      repo,
      { getById: jest.fn().mockResolvedValue(null) },
      { getById: jest.fn().mockResolvedValue(null) },
      { isBlocked: jest.fn().mockResolvedValue(false) },
    );

    const page1 = await service.getCharityProducts('dogs-trust', 'viewer-1', {
      limit: 2,
    });
    expect(page1!.data.products.map((item) => item.id)).toEqual(['p-3', 'p-2']);
    expect(page1!.meta.hasMore).toBe(true);
    expect(source.read).toHaveBeenCalledTimes(2);
    expect(source.read).toHaveBeenNthCalledWith(1, 3);
    expect(source.read).toHaveBeenNthCalledWith(2, 100);

    // Delete boundary product p-2 between requests.
    records = records.filter((item) => item.id !== 'p-2');

    const page2 = await service.getCharityProducts('dogs-trust', 'viewer-1', {
      limit: 2,
      cursor: page1!.meta.nextCursor!,
    });
    expect(page2!.data.products.map((item) => item.id)).toEqual(['p-1']);
    expect(page2!.meta.hasMore).toBe(false);
    expect(page2!.meta.nextCursor).toBeNull();
  });
});
