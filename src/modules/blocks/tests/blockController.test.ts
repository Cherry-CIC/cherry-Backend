import {
  blockUser,
  listBlockedUsers,
  unblockUser,
} from '../controllers/blockController';

const mockBlock = jest.fn();
const mockUnblock = jest.fn();
const mockListBlockedUsers = jest.fn();

jest.mock('../repositories/UserBlockRepository', () => ({
  UserBlockRepository: jest.fn().mockImplementation(() => ({
    block: mockBlock,
    unblock: mockUnblock,
    listBlockedUsers: mockListBlockedUsers,
  })),
}));

const response = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('blockController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks another user', async () => {
    mockBlock.mockResolvedValue({ id: 'block-1' });
    const res = response();

    await blockUser(
      { user: { uid: 'user-1' }, params: { userId: 'user-2' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockBlock).toHaveBeenCalledWith('user-1', 'user-2');
  });

  it('rejects blocking yourself', async () => {
    const res = response();

    await blockUser(
      { user: { uid: 'user-1' }, params: { userId: 'user-1' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockBlock).not.toHaveBeenCalled();
  });

  it('unblocks another user', async () => {
    const res = response();

    await unblockUser(
      { user: { uid: 'user-1' }, params: { userId: 'user-2' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockUnblock).toHaveBeenCalledWith('user-1', 'user-2');
  });

  it('lists blocked users for the authenticated user', async () => {
    mockListBlockedUsers.mockResolvedValue([{ blockedUserId: 'user-2' }]);
    const res = response();

    await listBlockedUsers({ user: { uid: 'user-1' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockListBlockedUsers).toHaveBeenCalledWith('user-1');
  });
});
