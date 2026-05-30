const mockGet = jest.fn();
const mockCollection = jest.fn();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  firestore: {
    collection: mockCollection,
  },
}));

import { PostageSizeRepository } from '../repositories/PostageSizeRepository';

describe('PostageSizeRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.mockReturnValue({
      get: mockGet,
    });
  });

  it('fetches postage sizes from Firestore and returns the frontend contract shape', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'medium-id',
          data: () => ({
            type: 'inpost',
            size: 'medium',
            description: 'Medium parcel',
          }),
        },
        {
          id: 'small-id',
          data: () => ({
            size: 'small',
            description: 'Small parcel',
          }),
        },
      ],
    });

    const result = await new PostageSizeRepository().getAll();

    expect(mockCollection).toHaveBeenCalledWith('postage_sizes');
    expect(result).toEqual([
      {
        id: 'small-id',
        type: 'inpost',
        size: 'small',
        description: 'Small parcel',
        createdAt: undefined,
        updatedAt: undefined,
      },
      {
        id: 'medium-id',
        type: 'inpost',
        size: 'medium',
        description: 'Medium parcel',
        createdAt: undefined,
        updatedAt: undefined,
      },
    ]);
  });

  it('falls back to the document ID for size when the document has no size field', async () => {
    mockGet.mockResolvedValue({
      docs: [
        {
          id: 'large',
          data: () => ({
            description: 'Large parcel',
          }),
        },
      ],
    });

    const result = await new PostageSizeRepository().getAll();

    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'large',
        type: 'inpost',
        size: 'large',
        description: 'Large parcel',
      }),
    );
  });
});
