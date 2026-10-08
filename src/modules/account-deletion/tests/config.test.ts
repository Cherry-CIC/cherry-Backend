import { loadDeletionPolicy, ordinaryResponseDeadline } from '../config';
import {
  ownedMediaPath,
  addMonths,
  financialExpiry,
  validResolution,
} from '../cleanup';
import { sameHash, tokenHash } from '../crypto';

const policy = {
  policyVersion: 'test',
  orderEvidenceMonths: 18,
  financialYears: 6,
  financialYearEndMonth: 3,
  financialYearEndDay: 31,
  auditDays: 30,
  backupDays: 30,
  reviewDays: 7,
};
const env = {
  ACCOUNT_DELETION_MODE: 'emulator',
  FIREBASE_PROJECT_ID: 'demo-test',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  ACCOUNT_DELETION_POLICY: JSON.stringify(policy),
};
test('destructive configuration fails closed; test policies cannot point at live projects', () => {
  expect(() => loadDeletionPolicy({})).toThrow('DELETION_UNAVAILABLE');
  expect(() =>
    loadDeletionPolicy({ ...env, FIREBASE_PROJECT_ID: 'live-project' }),
  ).toThrow();
  expect(() =>
    loadDeletionPolicy({ ...env, ACCOUNT_DELETION_MODE: 'production' }),
  ).toThrow('PRODUCTION_READINESS_REQUIRED');
  expect(() =>
    loadDeletionPolicy({ ...env, ACCOUNT_DELETION_POLICY: '{}' }),
  ).toThrow();
  expect(loadDeletionPolicy(env)).toEqual(policy);
});
test('calendar response and evidence deadlines clamp month ends independently from 28-day target', () => {
  expect(
    ordinaryResponseDeadline(new Date('2028-01-31T12:00:00Z')).toISOString(),
  ).toBe('2028-02-29T12:00:00.000Z');
  expect(addMonths(new Date('2026-08-31T00:00:00Z'), 6).toISOString()).toBe(
    '2027-02-28T00:00:00.000Z',
  );
  expect(financialExpiry(new Date('2026-04-01'), policy).toISOString()).toBe(
    '2033-03-31T23:59:59.999Z',
  );
});
test('production requires explicit extension review evidence before acceptance', () => {
  const readiness = Object.fromEntries(
    [
      'policy',
      'firestoreRules',
      'storageRules',
      'inventory',
      'providers',
      'backups',
      'scheduler',
      'alerts',
      'support',
      'frontend',
      'apple',
    ].map((key) => [key, `reviewed-${key}`]),
  );
  const production = {
    ...env,
    ACCOUNT_DELETION_MODE: 'production',
    ACCOUNT_DELETION_APPROVED_POLICY: policy.policyVersion,
    ACCOUNT_DELETION_READINESS: JSON.stringify(readiness),
  };
  expect(() => loadDeletionPolicy(production)).toThrow(
    'PRODUCTION_READINESS_REQUIRED',
  );
  expect(
    loadDeletionPolicy({
      ...production,
      ACCOUNT_DELETION_READINESS: JSON.stringify({
        ...readiness,
        extensions: 'reviewed-extension-deployment',
      }),
    }),
  ).toEqual(policy);
});
test('media ownership rejects other users, foreign buckets, lookalike hosts and firstname paths', () => {
  const url = (path: string) =>
    `https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(path)}?token=secret`;
  expect(ownedMediaPath(url('products/u/variant/a.jpg'), 'u', 'bucket')).toBe(
    'products/u/variant/a.jpg',
  );
  expect(ownedMediaPath(url('products/user2/a.jpg'), 'u', 'bucket')).toBeNull();
  expect(
    ownedMediaPath(url('user_images/Sam_profile_picture.png'), 'u', 'bucket'),
  ).toBeNull();
  expect(ownedMediaPath(url('products/u/a.jpg'), 'u', 'other')).toBeNull();
  expect(
    ownedMediaPath(
      url('products/u/a.jpg').replace('.com/', '.com.evil/'),
      'u',
      'bucket',
    ),
  ).toBeNull();
});
test('receipt checks and review resolution reject incomplete evidence', () => {
  expect(sameHash(tokenHash('a'), tokenHash('b'))).toBe(false);
  expect(sameHash(tokenHash('a'), tokenHash('a'))).toBe(true);
  expect(sameHash('', '')).toBe(false);
  expect(validResolution({ status: 'resolved' })).toBe(false);
});
