const mockGetCharityById = jest.fn();
const mockGetPaginatedProductsWithDetails = jest.fn();

jest.mock('../repositories/CharityRepository', () => ({
  CharityRepository: jest.fn().mockImplementation(() => ({
    getAll: jest.fn(),
    getById: mockGetCharityById,
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('../../products/services/ServiceFactory', () => ({
  ServiceFactory: {
    getProductService: () => ({
      getPaginatedProductsWithDetails: mockGetPaginatedProductsWithDetails,
    }),
  },
}));

import { getCharityProducts } from '../controllers/charityController';

describe('getCharityProducts compatibility wrapper', () => {
  const response = () => {
    const res: any = {};
    res.setHeader = jest.fn();
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires authentication and sets private no-store cache headers', async () => {
    const res = response();

    await getCharityProducts(
      { params: { id: 'dogs-trust' }, query: {} } as any,
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockGetCharityById).not.toHaveBeenCalled();
    expect(mockGetPaginatedProductsWithDetails).not.toHaveBeenCalled();
  });

  it('validates limit bounds and cursor type before querying', async () => {
    for (const badQuery of [
      { limit: '100' },
      { limit: '0' },
      { limit: '10abc' },
      { cursor: ['bad'] },
    ]) {
      const res = response();
      await getCharityProducts(
        {
          user: { uid: 'viewer-1' },
          params: { id: 'dogs-trust' },
          query: badQuery,
        } as any,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockGetCharityById).not.toHaveBeenCalled();
    expect(mockGetPaginatedProductsWithDetails).not.toHaveBeenCalled();
  });

  it('returns 404 when the charity does not exist without calling ProductService', async () => {
    mockGetCharityById.mockResolvedValue(null);
    const res = response();

    await getCharityProducts(
      {
        user: { uid: 'viewer-1' },
        params: { id: 'missing-charity' },
        query: {},
      } as any,
      res,
    );

    expect(mockGetCharityById).toHaveBeenCalledWith('missing-charity');
    expect(mockGetPaginatedProductsWithDetails).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('delegates to ProductService.getPaginatedProductsWithDetails and returns paginated products with securityFee', async () => {
    mockGetCharityById.mockResolvedValue({
      id: 'dogs-trust',
      name: 'Dogs Trust',
    });
    mockGetPaginatedProductsWithDetails.mockResolvedValue({
      items: [
        {
          id: 'p-1',
          name: 'Jacket',
          price: 10,
          number: 1,
          charityId: 'dogs-trust',
          hasSales: false,
          hasBeenEdited: false,
          charity: { id: 'dogs-trust', name: 'Dogs Trust' },
        },
      ],
      limit: 10,
      nextCursor: 'cursor-2',
      hasMore: true,
    });
    const res = response();

    await getCharityProducts(
      {
        user: { uid: 'viewer-1' },
        params: { id: 'dogs-trust' },
        query: { limit: '10', cursor: 'cursor-1' },
      } as any,
      res,
    );

    expect(mockGetPaginatedProductsWithDetails).toHaveBeenCalledWith(
      { charityId: 'dogs-trust', limit: 10, cursor: 'cursor-1' },
      'viewer-1',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        products: [
          expect.objectContaining({
            id: 'p-1',
            status: 'active',
            securityFee: expect.any(Number),
          }),
        ],
      },
      meta: { limit: 10, nextCursor: 'cursor-2', hasMore: true },
    });
    const sentProduct = res.json.mock.calls[0][0].data.products[0];
    expect(sentProduct).not.toHaveProperty('hasSales');
    expect(sentProduct).not.toHaveProperty('hasBeenEdited');
  });

  it('returns 400 when ProductService throws Invalid cursor', async () => {
    mockGetCharityById.mockResolvedValue({ id: 'dogs-trust' });
    mockGetPaginatedProductsWithDetails.mockRejectedValue(
      new Error('Invalid cursor'),
    );
    const res = response();

    await getCharityProducts(
      {
        user: { uid: 'viewer-1' },
        params: { id: 'dogs-trust' },
        query: { cursor: 'bad-cursor' },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 503 without leaking internal error details on unexpected failure', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetCharityById.mockResolvedValue({ id: 'dogs-trust' });
    mockGetPaginatedProductsWithDetails.mockRejectedValue(
      new Error('sensitive firestore index error'),
    );
    const res = response();

    await getCharityProducts(
      {
        user: { uid: 'viewer-1' },
        params: { id: 'dogs-trust' },
        query: {},
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain(
      'sensitive',
    );
    errorSpy.mockRestore();
  });
});
