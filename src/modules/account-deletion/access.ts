import { firestore } from '../../shared/config/firebaseConfig';

export const DELETION_GUARDS = 'account_deletion_guards';

export class AccountRestrictedError extends Error {
  readonly code = 'ACCOUNT_DELETION_PENDING';
  constructor() {
    super('This account is closed for deletion');
  }
}

/** Guards are authoritative even when deletion acceptance/workers are disabled. */
export async function isAccountRestricted(
  uid: string,
  db: FirebaseFirestore.Firestore = firestore,
): Promise<boolean> {
  return (await db.collection(DELETION_GUARDS).doc(uid).get()).exists;
}

/** Read inside the same transaction as the write to serialise with acceptance. */
export async function assertAccountsActive(
  transaction: FirebaseFirestore.Transaction,
  uids: string[],
  db: FirebaseFirestore.Firestore = firestore,
): Promise<void> {
  if (uids.some((uid) => !uid)) throw new Error('Account ownership is missing');
  const guards = await Promise.all(
    [...new Set(uids)].map((uid) =>
      transaction.get(db.collection(DELETION_GUARDS).doc(uid)),
    ),
  );
  if (guards.some((guard) => guard.exists)) throw new AccountRestrictedError();
}

/** Use bounded batches and no cache: a new guard must hide existing public data. */
export async function filterActiveOwners<T>(
  values: T[],
  owner: (value: T) => string | undefined,
  db: FirebaseFirestore.Firestore = firestore,
): Promise<T[]> {
  const ids = [
    ...new Set(values.map(owner).filter((uid): uid is string => !!uid)),
  ];
  const restricted = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const refs = ids
      .slice(offset, offset + 100)
      .map((uid) => db.collection(DELETION_GUARDS).doc(uid));
    const docs = await db.getAll(...refs);
    docs.filter((doc) => doc.exists).forEach((doc) => restricted.add(doc.id));
  }
  return values.filter((value) => {
    const uid = owner(value);
    return !!uid && !restricted.has(uid);
  });
}
