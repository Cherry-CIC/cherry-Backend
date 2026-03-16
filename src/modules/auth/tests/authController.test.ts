import { Request, Response } from 'express';
import { syncProfile } from '../controllers/authController';

jest.mock('../../../shared/config/firebaseConfig', () => ({
  admin: {
    auth: jest.fn().mockReturnValue({
      createUser: jest.fn(),
      updateUser: jest.fn(),
    }),
  },
  clientAuth: {},
}));

jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
}));

jest.mock('../repositories/UserRepository');

import { UserRepository } from '../repositories/UserRepository';

const makeMockRes = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return res as Response;
};

const makeSyncReq = (user: object): Request =>
  ({
    user,
  }) as unknown as Request;

describe('syncProfile controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a profile from token data when one does not exist', async () => {
    const res = makeMockRes();

    (UserRepository.prototype.findOrCreateByFirebaseUid as jest.Mock).mockResolvedValue({
      user: {
        id: 'uid-123',
        firebaseUid: 'uid-123',
        email: 'new@example.com',
        displayName: 'new',
      },
      created: true,
    });

    await syncProfile(
      makeSyncReq({
        uid: 'uid-123',
        email: 'new@example.com',
      }),
      res
    );

    expect(UserRepository.prototype.findOrCreateByFirebaseUid).toHaveBeenCalledWith({
      firebaseUid: 'uid-123',
      email: 'new@example.com',
      displayName: 'new',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'User profile synchronised and created',
      })
    );
  });

  it('returns the existing profile when one already exists', async () => {
    const res = makeMockRes();

    (UserRepository.prototype.findOrCreateByFirebaseUid as jest.Mock).mockResolvedValue({
      user: {
        id: 'uid-123',
        firebaseUid: 'uid-123',
        email: 'existing@example.com',
        displayName: 'Existing User',
      },
      created: false,
    });

    await syncProfile(
      makeSyncReq({
        uid: 'uid-123',
        email: 'existing@example.com',
        name: 'Existing User',
        picture: 'https://example.com/avatar.jpg',
      }),
      res
    );

    expect(UserRepository.prototype.findOrCreateByFirebaseUid).toHaveBeenCalledWith({
      firebaseUid: 'uid-123',
      email: 'existing@example.com',
      displayName: 'Existing User',
      photoURL: 'https://example.com/avatar.jpg',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'User profile synchronised',
      })
    );
  });

  it('rejects tokens that do not include an email claim', async () => {
    const res = makeMockRes();

    await syncProfile(
      makeSyncReq({
        uid: 'uid-123',
      }),
      res
    );

    expect(UserRepository.prototype.findOrCreateByFirebaseUid).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Email claim is required to synchronise the user profile',
      })
    );
  });
});
