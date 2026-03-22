import { Request, Response } from 'express';
import { admin, clientAuth } from '../../../shared/config/firebaseConfig';
import { UserRepository } from '../repositories/UserRepository';
import { AuthService, IAuthService } from '../services/AuthService';
import { ResponseHandler } from '../../../shared/utils/responseHandler';
import { signInWithEmailAndPassword } from 'firebase/auth';

const userRepo = new UserRepository();

type AuthControllerDependencies = {
  authService: IAuthService;
};

const dependencies: AuthControllerDependencies = {
  authService: new AuthService(userRepo),
};

export const setAuthControllerDependencies = (
  overrides: Partial<AuthControllerDependencies>,
): void => {
  Object.assign(dependencies, overrides);
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, displayName, photoURL } = req.body;

    // Create user in Firebase Auth using Admin SDK
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
      ...(photoURL && { photoURL }),
    });

    // Create user profile in Firestore
    const userProfileData: any = {
      firebaseUid: userRecord.uid,
      email,
      displayName,
    };

    if (photoURL) {
      userProfileData.photoURL = photoURL;
    }

    const userProfile = await userRepo.create(userProfileData);

    // Sign in with the newly created user to get ID token
    const userCredential = await signInWithEmailAndPassword(
      clientAuth,
      email,
      password,
    );
    const idToken = await userCredential.user.getIdToken();

    ResponseHandler.created(
      res,
      {
        user: userProfile,
        token: idToken,
      },
      'User registered successfully',
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('email-already-exists')) {
        ResponseHandler.conflict(res, 'Email already exists', err.message);
        return;
      }
      if (err.message.includes('invalid-email')) {
        ResponseHandler.badRequest(res, 'Invalid email format', err.message);
        return;
      }
      if (err.message.includes('weak-password')) {
        ResponseHandler.badRequest(res, 'Password is too weak', err.message);
        return;
      }
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to register user',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const userCredential = await signInWithEmailAndPassword(
      clientAuth,
      email,
      password,
    );
    const firebaseUid = userCredential.user.uid;

    const userProfile = await userRepo.getByFirebaseUid(firebaseUid);
    console.log(userProfile);

    if (!userProfile) {
      ResponseHandler.notFound(
        res,
        'User profile not found',
        'User exists in Firebase Auth but not in database',
      );
      return;
    }

    // Get ID token from authenticated user
    const idToken = await userCredential.user.getIdToken();

    ResponseHandler.success(
      res,
      {
        user: userProfile,
        token: idToken,
      },
      'Login successful',
    );
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes('user-not-found') ||
        err.message.includes('auth/user-not-found')
      ) {
        ResponseHandler.notFound(
          res,
          'User not found',
          'No user found with this email',
        );
        return;
      }
      if (
        err.message.includes('invalid-email') ||
        err.message.includes('auth/invalid-email')
      ) {
        ResponseHandler.badRequest(res, 'Invalid email format', err.message);
        return;
      }
      if (
        err.message.includes('wrong-password') ||
        err.message.includes('auth/wrong-password') ||
        err.message.includes('auth/invalid-credential')
      ) {
        ResponseHandler.unauthorized(
          res,
          'Invalid credentials',
          'Email or password is incorrect',
        );
        return;
      }
      if (
        err.message.includes('user-disabled') ||
        err.message.includes('auth/user-disabled')
      ) {
        ResponseHandler.forbidden(
          res,
          'Account disabled',
          'This user account has been disabled',
        );
        return;
      }
      if (
        err.message.includes('too-many-requests') ||
        err.message.includes('auth/too-many-requests')
      ) {
        ResponseHandler.custom(
          res,
          429,
          false,
          'Too many attempts',
          undefined,
          'Too many failed login attempts. Please try again later.',
        );
        return;
      }
    }
    ResponseHandler.internalServerError(
      res,
      'Failed to login',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const getProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    const userProfile = await userRepo.getByFirebaseUid(user.uid);

    if (!userProfile) {
      ResponseHandler.notFound(
        res,
        'User profile not found',
        'User exists in Firebase Auth but not in database',
      );
      return;
    }

    ResponseHandler.success(
      res,
      userProfile,
      'User profile fetched successfully',
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to fetch user profile',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const updateProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    const { displayName, photoURL } = req.body;

    // Update Firebase Auth user
    await admin.auth().updateUser(user.uid, {
      displayName,
      photoURL,
    });

    // Update user profile in Firestore
    const userProfile = await userRepo.getByFirebaseUid(user.uid);
    if (!userProfile) {
      ResponseHandler.notFound(
        res,
        'User profile not found',
        'User exists in Firebase Auth but not in database',
      );
      return;
    }

    const updatedProfile = await userRepo.update(userProfile.id!, {
      displayName,
      photoURL,
    });

    ResponseHandler.success(
      res,
      updatedProfile,
      'User profile updated successfully',
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to update user profile',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};

export const deleteAccount = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    const firebaseUid = user?.uid;

    if (!firebaseUid) {
      ResponseHandler.unauthorized(
        res,
        'User not authenticated',
        'Authentication required',
      );
      return;
    }

    // Attempt deletion and always return a successful response with counts.
    // AuthService will attempt to delete the Firebase Auth user and then
    // remove any Firestore documents. If no Firestore profile exists, the
    // service will still return counts (possibly zeros).
    const deletedData = await dependencies.authService.deleteAccount(firebaseUid);

    const result = deletedData ?? {
      deletedUserProfiles: 0,
      deletedProducts: 0,
      deletedOrders: 0,
      deletedShipments: 0,
    };

    ResponseHandler.success(
      res,
      result,
      'User account and related Firestore documents deleted successfully',
    );
  } catch (err) {
    ResponseHandler.internalServerError(
      res,
      'Failed to delete user account',
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
};
