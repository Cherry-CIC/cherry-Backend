const mockRevokeRefreshTokens = jest.fn();
const mockDeleteUser = jest.fn();
const mockDeleteAccountData = jest.fn();

jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: () => ({
      revokeRefreshTokens: mockRevokeRefreshTokens,
      deleteUser: mockDeleteUser,
    }),
  },
}));

jest.mock('../repositories/UserRepository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    deleteAccountData: mockDeleteAccountData,
  })),
}));

import { AuthService } from '../services/AuthService';
import { deleteAccount } from '../controllers/authController';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('AuthService.deleteAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteAccountData.mockResolvedValue({
      deletedUserProfiles: 1,
      deletedUnsoldProducts: 2,
      anonymisedProducts: 1,
      anonymisedOrders: 3,
      anonymisedShipments: 3,
      deletedLikes: 4,
    });
  });

  it('revokes tokens, deletes auth user, and performs retention-aware cleanup', async () => {
    const service = new AuthService();

    const result = await service.deleteAccount('user-1');

    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('user-1');
    expect(mockDeleteAccountData).toHaveBeenCalledWith('user-1');
    expect(mockDeleteAccountData.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteUser.mock.invocationCallOrder[0],
    );
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      deletedUserProfiles: 1,
      deletedUnsoldProducts: 2,
      anonymisedProducts: 1,
      anonymisedOrders: 3,
      anonymisedShipments: 3,
      deletedLikes: 4,
    });
  });

  it('continues cleanup if the Firebase Auth user is already gone', async () => {
    mockDeleteUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    const service = new AuthService();

    await service.deleteAccount('user-1');

    expect(mockDeleteAccountData).toHaveBeenCalledWith('user-1');
  });
});

describe('authController.deleteAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteAccountData.mockResolvedValue({
      deletedUserProfiles: 1,
      deletedUnsoldProducts: 0,
      anonymisedProducts: 1,
      anonymisedOrders: 2,
      anonymisedShipments: 2,
      deletedLikes: 1,
    });
  });

  it('returns 401 when the request is unauthenticated', async () => {
    const req: any = {};
    const res = createResponse();

    await deleteAccount(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns the retention-aware cleanup summary for an authenticated user', async () => {
    const req: any = {
      user: {
        uid: 'user-1',
      },
    };
    const res = createResponse();

    await deleteAccount(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Account deleted successfully',
        data: {
          deletedUserProfiles: 1,
          deletedUnsoldProducts: 0,
          anonymisedProducts: 1,
          anonymisedOrders: 2,
          anonymisedShipments: 2,
          deletedLikes: 1,
        },
      }),
    );
  });
});
