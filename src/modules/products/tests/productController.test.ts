const mockGetPaginatedProducts = jest.fn();
const mockGetPaginatedProductsWithDetails = jest.fn();

jest.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getProductService: () => ({
      getPaginatedProducts: mockGetPaginatedProducts,
      getPaginatedProductsWithDetails: mockGetPaginatedProductsWithDetails,
    }),
  },
}));

import {
  getAllProducts,
  getAllProductsWithDetails,
} from '../controllers/productController';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('product feed controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const emptyPage = {
      items: [],
      limit: 20,
      nextCursor: null,
      hasMore: false,
    };
    mockGetPaginatedProducts.mockResolvedValue(emptyPage);
    mockGetPaginatedProductsWithDetails.mockResolvedValue(emptyPage);
  });

  it.each([
    ['products', getAllProducts, mockGetPaginatedProducts],
    [
      'products with details',
      getAllProductsWithDetails,
      mockGetPaginatedProductsWithDetails,
    ],
  ])(
    'scopes the %s feed away from the authenticated seller',
    async (_name, controller, serviceMethod) => {
      const req: any = {
        user: { uid: 'seller-1' },
        query: { limit: 20, search: 'jumper' },
      };
      const res = createResponse();

      await controller(req, res);

      expect(serviceMethod).toHaveBeenCalledWith({
        limit: 20,
        search: 'jumper',
        excludeUserId: 'seller-1',
      });
      expect(res.status).toHaveBeenCalledWith(200);
    },
  );
});
