const mockGetProductService = jest.fn();

jest.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getProductService: mockGetProductService,
  },
}));

import {
  getAllProducts,
  getAllProductsWithDetails,
  relistProduct,
  unlistProduct,
} from '../controllers/productController';

const createResponse = () => {
  const res: any = {};
  res.setHeader = jest.fn();
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('productController listing status actions', () => {
  const productService = {
    getProductById: jest.fn(),
    unlistProduct: jest.fn(),
    relistProduct: jest.fn(),
    getPaginatedProducts: jest.fn(),
    getPaginatedProductsWithDetails: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProductService.mockReturnValue(productService);
  });

  it('lets a seller unlist their own product', async () => {
    productService.getProductById.mockResolvedValue({
      id: 'product-1',
      userId: 'seller-1',
      status: 'active',
    });
    productService.unlistProduct.mockResolvedValue({
      id: 'product-1',
      userId: 'seller-1',
      status: 'unlisted',
    });
    const req: any = {
      user: { uid: 'seller-1' },
      params: { id: 'product-1' },
    };
    const res = createResponse();

    await unlistProduct(req, res);

    expect(productService.unlistProduct).toHaveBeenCalledWith(
      'product-1',
      'seller-1',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Product unlisted successfully',
        data: expect.objectContaining({
          status: 'unlisted',
        }),
      }),
    );
  });

  it('forbids unlisting another seller’s product', async () => {
    productService.getProductById.mockResolvedValue({
      id: 'product-1',
      userId: 'seller-2',
      status: 'active',
    });
    const req: any = {
      user: { uid: 'seller-1' },
      params: { id: 'product-1' },
    };
    const res = createResponse();

    await unlistProduct(req, res);

    expect(productService.unlistProduct).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('lets a seller relist their own product', async () => {
    productService.getProductById.mockResolvedValue({
      id: 'product-1',
      userId: 'seller-1',
      status: 'unlisted',
      number: 1,
    });
    productService.relistProduct.mockResolvedValue({
      id: 'product-1',
      userId: 'seller-1',
      status: 'active',
      number: 1,
    });
    const req: any = {
      user: { uid: 'seller-1' },
      params: { id: 'product-1' },
    };
    const res = createResponse();

    await relistProduct(req, res);

    expect(productService.relistProduct).toHaveBeenCalledWith(
      'product-1',
      'seller-1',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Product relisted successfully',
        data: expect.objectContaining({
          status: 'active',
        }),
      }),
    );
  });

  it('returns conflict when a product cannot be relisted', async () => {
    productService.getProductById.mockResolvedValue({
      id: 'product-1',
      userId: 'seller-1',
      status: 'sold',
      number: 0,
    });
    productService.relistProduct.mockRejectedValue(
      new Error('Sold products cannot be relisted'),
    );
    const req: any = {
      user: { uid: 'seller-1' },
      params: { id: 'product-1' },
    };
    const res = createResponse();

    await relistProduct(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('requires authentication and sets private no-store cache headers on product list endpoints', async () => {
    for (const handler of [getAllProducts, getAllProductsWithDetails]) {
      const res = createResponse();
      await handler({ query: {} } as any, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-store',
      );
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(productService.getPaginatedProducts).not.toHaveBeenCalled();
    expect(
      productService.getPaginatedProductsWithDetails,
    ).not.toHaveBeenCalled();
  });

  it('forwards viewerId and query filters for getAllProducts and getAllProductsWithDetails', async () => {
    const product = {
      id: 'product-1',
      name: 'Jacket',
      price: 10,
      charityId: 'charity-1',
      status: 'active',
      hasSales: false,
      hasBeenEdited: false,
    };
    productService.getPaginatedProducts.mockResolvedValue({
      items: [product],
      limit: 20,
      nextCursor: null,
      hasMore: false,
    });
    productService.getPaginatedProductsWithDetails.mockResolvedValue({
      items: [{ ...product, charity: { id: 'charity-1', name: 'Charity' } }],
      limit: 20,
      nextCursor: 'next-1',
      hasMore: true,
    });

    const listRes = createResponse();
    await getAllProducts(
      {
        user: { uid: 'viewer-1' },
        query: { charityId: 'charity-1', limit: 20 },
      } as any,
      listRes,
    );

    expect(productService.getPaginatedProducts).toHaveBeenCalledWith(
      { charityId: 'charity-1', limit: 20 },
      'viewer-1',
    );
    expect(listRes.status).toHaveBeenCalledWith(200);
    expect(listRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          products: [
            expect.objectContaining({
              id: 'product-1',
              securityFee: expect.any(Number),
            }),
          ],
        },
      }),
    );

    const detailsRes = createResponse();
    await getAllProductsWithDetails(
      {
        user: { uid: 'viewer-1' },
        query: { charityId: 'charity-1', limit: 20 },
      } as any,
      detailsRes,
    );

    expect(
      productService.getPaginatedProductsWithDetails,
    ).toHaveBeenCalledWith(
      { charityId: 'charity-1', limit: 20 },
      'viewer-1',
    );
    expect(detailsRes.status).toHaveBeenCalledWith(200);
    expect(detailsRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        meta: { limit: 20, nextCursor: 'next-1', hasMore: true },
        data: {
          products: [
            expect.objectContaining({
              id: 'product-1',
              charity: { id: 'charity-1', name: 'Charity' },
              securityFee: expect.any(Number),
            }),
          ],
        },
      }),
    );
  });
});
