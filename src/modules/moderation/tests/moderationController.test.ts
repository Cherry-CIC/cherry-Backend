import {
  moderateProduct,
  moderateUser,
} from '../controllers/moderationController';

const mockModerateProduct = jest.fn();
const mockModerateUser = jest.fn();

jest.mock('../repositories/ModerationRepository', () => ({
  ModerationRepository: jest.fn().mockImplementation(() => ({
    moderateProduct: mockModerateProduct,
    moderateUser: mockModerateUser,
  })),
}));

const response = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('moderationController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides a product', async () => {
    mockModerateProduct.mockResolvedValue(true);
    const res = response();

    await moderateProduct(
      {
        user: { uid: 'admin-1' },
        params: { productId: 'product-1' },
        body: { action: 'hide', reason: 'prohibited_content' },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockModerateProduct).toHaveBeenCalledWith(
      'product-1',
      'hide',
      'admin-1',
      'prohibited_content',
    );
  });

  it('suspends a user', async () => {
    mockModerateUser.mockResolvedValue(true);
    const res = response();

    await moderateUser(
      {
        user: { uid: 'admin-1' },
        params: { userId: 'user-2' },
        body: { action: 'suspend', reason: 'harassment' },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockModerateUser).toHaveBeenCalledWith(
      'user-2',
      'suspend',
      'admin-1',
      'harassment',
    );
  });
});
