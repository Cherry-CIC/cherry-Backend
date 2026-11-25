import { FieldPath } from 'firebase-admin/firestore';

const mockGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockGet }));
const mockSelect = jest.fn(() => ({ limit: mockLimit }));
const mockOrderBy: jest.Mock = jest.fn(() => ({
  orderBy: mockOrderBy,
  select: mockSelect,
}));
const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
const mockGetAll = jest.fn();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: jest.fn(() => ({
      where: mockWhere,
      doc: (id: string) => ({ id }),
    })),
    getAll: mockGetAll,
  },
}));

import { ProductLikeRepository } from '../repositories/ProductLikeRepository';

const likeDoc = (productId: string) => ({
  get: (field: string) => (field === 'productId' ? productId : undefined),
});

describe('ProductLikeRepository.getLikedProductIds', () => {
  it("reads only the newest likes, sorted like the Liked screen's", async () => {
    // Firestore sorts them, newest first.
    mockGet.mockResolvedValue({
      docs: [likeDoc('newest'), likeDoc('middle'), likeDoc('older')],
    });

    const ids = await new ProductLikeRepository().getLikedProductIds(
      'user-1',
      100,
    );

    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');
    // The same sort as getLikedProductsPage, so it needs no new index.
    expect(mockOrderBy.mock.calls).toEqual([
      ['createdAt', 'desc'],
      [FieldPath.documentId(), 'desc'],
    ]);
    expect(mockSelect).toHaveBeenCalledWith('productId');
    expect(mockLimit).toHaveBeenCalledWith(100);
    expect(ids).toEqual(['newest', 'middle', 'older']);
  });
});

describe('ProductLikeRepository.getLikedProductIdsAmong', () => {
  it('returns which of the given products the user has liked', async () => {
    mockGetAll.mockResolvedValue([
      { exists: true },
      { exists: false },
      { exists: true },
    ]);

    const ids = await new ProductLikeRepository().getLikedProductIdsAmong(
      'user-1',
      ['a', 'b', 'c'],
    );

    // Each like's id is the user id and product id joined by "_".
    expect(mockGetAll).toHaveBeenCalledWith(
      { id: 'user-1_a' },
      { id: 'user-1_b' },
      { id: 'user-1_c' },
    );
    expect(ids).toEqual(['a', 'c']);
  });

  it('reads nothing when there are no products to check', async () => {
    mockGetAll.mockClear();

    const ids = await new ProductLikeRepository().getLikedProductIdsAmong(
      'user-1',
      [],
    );

    expect(ids).toEqual([]);
    expect(mockGetAll).not.toHaveBeenCalled();
  });
});
