import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { admin, firestore } from '../../../shared/config/firebaseConfig';
import { PublicUser } from '../model/PublicProfile';

const MAX_LINKED_PROFILES = 20;
const PROFILE_FIELDS = [
  'id',
  'firebaseUid',
  'username',
  'profileImageUrl',
  'photoURL',
  'photoUrl',
];

type ProfileRecord = Record<string, unknown>;

const publicUsername = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const publicImage = (record: ProfileRecord): string | null => {
  for (const field of ['profileImageUrl', 'photoURL', 'photoUrl']) {
    const value = record[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }

    try {
      const url = new URL(value.trim());
      if (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        url.hostname &&
        !url.username &&
        !url.password
      ) {
        return url.href;
      }
    } catch {
      // Invalid legacy images are absent public values, not operational errors.
    }
  }

  return null;
};

const hasConflictingIdentity = (record: ProfileRecord, uid: string): boolean =>
  ['id', 'firebaseUid'].some(
    (field) => record[field] !== undefined && record[field] !== uid,
  );

/** Resolves both storage layouts without exposing either document shape. */
export class PublicUserRepository {
  constructor(
    private readonly db: Firestore = firestore,
    private readonly auth: Pick<Auth, 'getUser'> = admin.auth(),
  ) {}

  async getByFirebaseUid(uid: string): Promise<PublicUser | null> {
    if (!uid || uid === 'deleted_user') {
      return null;
    }

    // Authentication is authoritative for account availability. Stale Firestore
    // profiles must not make deleted or disabled accounts publicly available.
    try {
      const account = await this.auth.getUser(uid);
      if (account.disabled || account.uid !== uid) {
        return null;
      }
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (code === 'auth/user-not-found' || code === 'auth/user-disabled') {
        return null;
      }
      throw error;
    }

    const users = this.db.collection('users');
    const [[canonicalDoc], linkedSnapshot] = await Promise.all([
      this.db.getAll(users.doc(uid), { fieldMask: PROFILE_FIELDS }),
      users
        .where('id', '==', uid)
        .select(...PROFILE_FIELDS)
        .limit(MAX_LINKED_PROFILES + 1)
        .get(),
    ]);

    // Never choose an arbitrary subset when a damaged account has too many
    // linked records. Such accounts need a reviewed profile migration.
    if (linkedSnapshot.size > MAX_LINKED_PROFILES) {
      return null;
    }

    const canonical = canonicalDoc.exists ? canonicalDoc.data()! : undefined;
    const legacy = linkedSnapshot.docs
      .filter((document) => document.id !== uid)
      .map((document) => document.data());

    if (!canonical && legacy.length === 0) {
      return null;
    }
    if (
      (canonical && hasConflictingIdentity(canonical, uid)) ||
      legacy.some((record) => hasConflictingIdentity(record, uid))
    ) {
      return null;
    }

    const legacyNames = new Set(
      legacy
        .map((record) => publicUsername(record.username))
        .filter((value): value is string => value !== null),
    );
    const legacyImages = new Set(
      legacy
        .map(publicImage)
        .filter((value): value is string => value !== null),
    );
    if (legacyNames.size > 1 || legacyImages.size > 1) {
      return null;
    }

    // A chosen username is the only verified public name. Flutter's firstname
    // can contain a provider's full name; neither it, displayName nor email is
    // an approved fallback. Existing profiles without a username use "User".
    // Canonical values win over an unambiguous linked legacy value. Missing or
    // invalid avatar aliases fall through in the order listed in publicImage.
    return {
      id: uid,
      username:
        (canonical ? publicUsername(canonical.username) : null) ??
        legacyNames.values().next().value ??
        'User',
      profileImageUrl:
        (canonical ? publicImage(canonical) : null) ??
        legacyImages.values().next().value ??
        null,
    };
  }
}
