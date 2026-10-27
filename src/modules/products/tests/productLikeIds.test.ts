import { Timestamp } from 'firebase-admin/firestore';

const mockGet = jest.fn();
const mockSelect = jest.fn(() => ({ get: mockGet }));
const mockWhere = jest.fn(() => ({ select: mockSelect }));
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

const likeDoc = (productId: string, likedAt: string) => ({
  get: (field: string) =>
    field === 'productId'
      ? productId
      : field === 'createdAt'
        ? Timestamp.fromDate(new Date(likedAt))
        : undefined,
});

describe('ProductLikeRepository.getLikedProductIds', () => {
  it('returns the liked product ids, newest like first', async () => {
    mockGet.mockResolvedValue({
      docs: [
        likeDoc('older', '2026-10-01T10:00:00Z'),
        likeDoc('newest', '2026-10-20T10:00:00Z'),
        likeDoc('middle', '2026-10-10T10:00:00Z'),
      ],
    });

    const ids = await new ProductLikeRepository().getLikedProductIds('user-1');

    expect(mockWhere).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(mockSelect).toHaveBeenCalledWith('productId', 'createdAt');
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
