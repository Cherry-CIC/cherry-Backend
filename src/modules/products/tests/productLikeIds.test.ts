import { Timestamp } from 'firebase-admin/firestore';

const mockGet = jest.fn();
const mockSelect = jest.fn(() => ({ get: mockGet }));
const mockWhere = jest.fn(() => ({ select: mockSelect }));

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: { collection: jest.fn(() => ({ where: mockWhere })) },
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
