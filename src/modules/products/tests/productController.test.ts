const mockGetProductService = jest.fn();

jest.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getProductService: mockGetProductService,
  },
}));

import { relistProduct, unlistProduct } from '../controllers/productController';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('productController listing status actions', () => {
  const productService = {
    getProductById: jest.fn(),
    unlistProduct: jest.fn(),
    relistProduct: jest.fn(),
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

    expect(productService.unlistProduct).toHaveBeenCalledWith('product-1');
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

    expect(productService.relistProduct).toHaveBeenCalledWith('product-1');
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
});
