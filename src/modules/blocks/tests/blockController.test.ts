import {
  blockCharity,
  blockUser,
  listBlockedCharities,
  listBlockedUsers,
  unblockCharity,
  unblockUser,
} from '../controllers/blockController';

const mockBlock = jest.fn();
const mockUnblock = jest.fn();
const mockListBlockedUsers = jest.fn();
const mockCharityBlock = jest.fn();
const mockCharityUnblock = jest.fn();
const mockListBlockedCharities = jest.fn();

jest.mock('../repositories/UserBlockRepository', () => ({
  UserBlockRepository: jest.fn().mockImplementation(() => ({
    block: mockBlock,
    unblock: mockUnblock,
    listBlockedUsers: mockListBlockedUsers,
  })),
}));

jest.mock('../repositories/CharityBlockRepository', () => ({
  CharityBlockRepository: jest.fn().mockImplementation(() => ({
    block: mockCharityBlock,
    unblock: mockCharityUnblock,
    listBlockedCharities: mockListBlockedCharities,
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

  it('blocks a charity', async () => {
    mockCharityBlock.mockResolvedValue({ id: 'charity-block-1' });
    const res = response();

    await blockCharity(
      { user: { uid: 'user-1' }, params: { charityId: 'dogs-trust' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockCharityBlock).toHaveBeenCalledWith('user-1', 'dogs-trust');
  });

  it('rejects invalid charity block identifiers', async () => {
    const res = response();

    await blockCharity(
      { user: { uid: 'user-1' }, params: { charityId: '..' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCharityBlock).not.toHaveBeenCalled();
  });

  it('unblocks a charity', async () => {
    const res = response();

    await unblockCharity(
      { user: { uid: 'user-1' }, params: { charityId: 'dogs-trust' } } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockCharityUnblock).toHaveBeenCalledWith('user-1', 'dogs-trust');
  });

  it('lists blocked charities for the authenticated user', async () => {
    mockListBlockedCharities.mockResolvedValue([
      { blockedCharityId: 'dogs-trust' },
    ]);
    const res = response();

    await listBlockedCharities({ user: { uid: 'user-1' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockListBlockedCharities).toHaveBeenCalledWith('user-1');
  });
});
