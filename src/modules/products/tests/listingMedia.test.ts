const mockProvenance = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({ get: async () => ({ data: mockProvenance }) }),
    }),
  }),
}));
import { Readable } from 'stream';
import sharp from 'sharp';
import { localFirebaseEmulators } from '../../../shared/config/firebaseEmulators';
import { parseListingEdit } from '../validators/productValidator';
import {
  ListingMediaService,
  MAX_PHOTO_BYTES,
} from '../services/ListingMediaService';

const bucketName = 'demo-cherry-listing.appspot.com';
const url = (name = 'listing-media-v1/seller/test.png') =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(name)}?alt=media&token=token`;
let bytes: Buffer;
let metadata: any;
let bucket: any;
const originalEnv = { ...process.env };
const emulatorEnv = {
  NODE_ENV: 'development',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
};
beforeAll(async () => {
  bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
});
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(emulatorEnv).filter(
    (key) => key !== 'NODE_ENV',
  ))
    delete process.env[key];
  delete process.env.STORAGE_EMULATOR_HOST;
  process.env.LISTING_MEDIA_BUCKET = bucketName;
  process.env.LISTING_MEDIA_POLICY_START = '2026-01-01T00:00:00Z';
  process.env.LISTING_MEDIA_RULES_VERIFIED = 'true';
  metadata = {
    size: bytes.length,
    generation: '1',
    timeCreated: '2026-02-01T00:00:00Z',
    contentType: 'image/png',
    metadata: {
      ownerUid: 'seller',
      mediaPolicy: 'listing-v1',
      firebaseStorageDownloadTokens: 'token',
    },
  };
  bucket = {
    file: jest.fn(() => ({
      getMetadata: jest.fn(async () => [metadata]),
      createReadStream: () => Readable.from([bytes]),
    })),
  };
});
afterAll(() => {
  process.env = originalEnv;
});

test('accepts an owned emulator photo only with all local services configured', async () => {
  const localUrl = url().replace(
    'https://firebasestorage.googleapis.com',
    'http://127.0.0.1:9199',
  );
  const service = new ListingMediaService(bucket);
  const edit = { expectedEditVersion: 0, product_images: [localUrl] };
  expect(() => parseListingEdit(edit)).toThrow();
  await expect(
    service.validate('seller', [localUrl], []),
  ).rejects.toMatchObject({ code: 'LISTING_INVALID_MEDIA' });
  Object.assign(process.env, emulatorEnv);
  expect(parseListingEdit(edit)).toEqual(edit);
  await expect(
    service.validate('seller', [localUrl], []),
  ).resolves.toBeUndefined();
  metadata.metadata.ownerUid = 'other';
  await expect(
    service.validate('seller', [localUrl], []),
  ).rejects.toMatchObject({ code: 'LISTING_INVALID_MEDIA' });
});

test.each([
  'http://127.0.0.1.evil.example:9199',
  'http://127.0.0.1:9298',
  'http://user@127.0.0.1:9199',
  'https://127.0.0.1:9199',
  'http://firebasestorage.googleapis.com',
])('rejects unapproved emulator URL origin %s', async (origin) => {
  Object.assign(process.env, emulatorEnv);
  const raw = url().replace('https://firebasestorage.googleapis.com', origin);
  if (raw.startsWith('http:'))
    expect(() =>
      parseListingEdit({ expectedEditVersion: 0, product_images: [raw] }),
    ).toThrow();
  await expect(
    new ListingMediaService(bucket).validate('seller', [raw], []),
  ).rejects.toMatchObject({ code: 'LISTING_INVALID_MEDIA' });
  expect(bucket.file).not.toHaveBeenCalled();
});

test('rejects local photo access in production, even with emulator variables set', async () => {
  Object.assign(process.env, emulatorEnv, { NODE_ENV: 'production' });
  const localUrl = url().replace(
    'https://firebasestorage.googleapis.com',
    'http://127.0.0.1:9199',
  );
  expect(() =>
    parseListingEdit({ expectedEditVersion: 0, product_images: [localUrl] }),
  ).toThrow();
  await expect(
    new ListingMediaService(bucket).validate('seller', [localUrl], []),
  ).rejects.toThrow('must not be enabled in production');
  expect(bucket.file).not.toHaveBeenCalled();
});

test.each([
  { FIRESTORE_EMULATOR_HOST: undefined },
  { FIREBASE_AUTH_EMULATOR_HOST: 'auth.example:9099' },
  { FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1.evil.example:9199' },
  { FIREBASE_STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199' },
  { FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:65536' },
  { STORAGE_EMULATOR_HOST: 'https://storage.googleapis.com' },
])('refuses partial or external emulator configuration %j', (change) => {
  expect(() => localFirebaseEmulators({ ...emulatorEnv, ...change })).toThrow();
});

test('keeps hosted Firebase configuration unchanged when no emulator hosts are set', () => {
  expect(localFirebaseEmulators({ NODE_ENV: 'production' })).toBeUndefined();
  expect(
    localFirebaseEmulators({
      ...emulatorEnv,
      STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
    }),
  ).toMatchObject({ storageOrigin: 'http://127.0.0.1:9199' });
});
test('still parses HTTPS edits in the Firestore and Storage-only rules test harness', () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8188';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9298';
  const edit = { expectedEditVersion: 0, product_images: [url()] };
  expect(parseListingEdit(edit)).toEqual(edit);
});
test('accepts a fully decoded owned immutable object', async () => {
  await expect(
    new ListingMediaService(bucket).validate('seller', [url()], []),
  ).resolves.toBeUndefined();
  expect(bucket.file).toHaveBeenCalledWith('listing-media-v1/seller/test.png', {
    generation: '1',
  });
});
test.each([
  'https://evil.example/image.png',
  url() + '&generation=123',
  url() + '&token=other',
  url('listing-media-v1/other/test.png'),
  url('products/other/test.png'),
  url().replace('token=token', 'token=forged'),
])('rejects external, unrelated or inaccessible media', async (raw) => {
  await expect(
    new ListingMediaService(bucket).validate('seller', [raw], [raw]),
  ).rejects.toMatchObject({ code: 'LISTING_INVALID_MEDIA' });
});
test.each([
  { timeCreated: '2025-01-01T00:00:00Z' },
  { contentType: 'image/svg+xml' },
  { size: MAX_PHOTO_BYTES + 1 },
  { metadata: { ownerUid: 'other' } },
])('rejects invalid metadata %j', async (change) => {
  metadata = { ...metadata, ...change };
  await expect(
    new ListingMediaService(bucket).validate('seller', [url()], []),
  ).rejects.toMatchObject({ code: 'LISTING_INVALID_MEDIA' });
});
test('rejects spoofed image content', async () => {
  bucket.file.mockImplementation(() => ({
    getMetadata: async () => [{ ...metadata, size: 4 }],
    createReadStream: () => Readable.from([Buffer.from('fake')]),
  }));
  await expect(
    new ListingMediaService(bucket).validate('seller', [url()], []),
  ).rejects.toMatchObject({ code: 'LISTING_INVALID_MEDIA' });
});
test('requires verified rules, refuses duplicate objects and excessive count', async () => {
  const service = new ListingMediaService(bucket);
  await expect(
    service.validate('seller', [url(), url()], []),
  ).rejects.toThrow();
  await expect(
    service.validate('seller', Array(11).fill(url()), []),
  ).rejects.toThrow();
  delete process.env.LISTING_MEDIA_RULES_VERIFIED;
  await expect(service.validate('seller', [url()], [])).rejects.toMatchObject({
    code: 'LISTING_MEDIA_NOT_READY',
  });
});

test('accepts retained legacy photos only with matching server-owned generation evidence', async () => {
  const legacyPath = 'products/seller/old.png';
  mockProvenance.mockReturnValue({
    ownerUid: 'seller',
    bucket: bucketName,
    path: legacyPath,
    generation: '1',
  });
  await expect(
    new ListingMediaService(bucket).validate(
      'seller',
      [url(legacyPath)],
      [url(legacyPath)],
    ),
  ).resolves.toBeUndefined();
  mockProvenance.mockReturnValue({
    ownerUid: 'seller',
    bucket: bucketName,
    path: legacyPath,
    generation: 'old-generation',
  });
  await expect(
    new ListingMediaService(bucket).validate(
      'seller',
      [url(legacyPath)],
      [url(legacyPath)],
    ),
  ).rejects.toMatchObject({ code: 'LISTING_INVALID_MEDIA' });
});

test('does not validate a hosted photo against local emulator metadata', async () => {
  Object.assign(process.env, emulatorEnv);
  await expect(
    new ListingMediaService(bucket).validate('seller', [url()], []),
  ).rejects.toMatchObject({ code: 'LISTING_INVALID_MEDIA' });
});
