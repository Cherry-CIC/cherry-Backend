import {
  canonicalMedia,
  mediaKey,
  photoManifest,
  referencesMedia,
} from '../cleanup/media';
import { ListingCleanupStorage } from '../cleanup/storage';
import { cleanupArguments } from '../../../scripts/listingCleanup';

const photo = {
  bucket: 'demo-cherry.appspot.com',
  name: 'listing-media-v1/seller/a.png',
};
const firebaseUrl = `https://firebasestorage.googleapis.com/v0/b/${photo.bucket}/o/${encodeURIComponent(photo.name)}?alt=media&token=secret`;

test.each([
  firebaseUrl,
  `https://storage.cloud.google.com/${photo.bucket}/${photo.name}`,
  `https://storage.googleapis.com/download/storage/v1/b/${photo.bucket}/o/${encodeURIComponent(photo.name)}?alt=media`,
  `https://storage.googleapis.com/${photo.bucket}/${photo.name}`,
  `https://${photo.bucket}.storage.googleapis.com/${photo.name}`,
  `gs://${photo.bucket}/${photo.name}`,
])(
  'normalises supported object aliases without retaining tokens: %s',
  (url) => {
    expect(canonicalMedia(url)).toEqual(photo);
    expect(mediaKey(canonicalMedia(url)!)).toBe(mediaKey(photo));
    expect(referencesMedia({ snapshot: { images: [url] } }, photo)).toBe(true);
  },
);

test.each([
  'https://evil.test/a.png',
  'not a URL',
  'https://firebasestorage.googleapis.com/v0/b/a/o/%ZZ',
  null,
])('preserves uncertainty for malformed or external photos', (value) => {
  expect(canonicalMedia(value)).toBeNull();
});

test('manifest deduplicates aliases, drops tokens and counts uncertain photos', () => {
  expect(
    photoManifest([
      firebaseUrl,
      `gs://${photo.bucket}/${photo.name}`,
      'https://other.test/photo',
    ]),
  ).toEqual({ photos: [photo], unverifiedPhotos: 1 });
  expect(JSON.stringify(photoManifest([firebaseUrl]))).not.toContain('secret');
});

const config = {
  LISTING_MEDIA_BUCKET: photo.bucket,
  LISTING_MEDIA_POLICY_START: '2026-01-01T00:00:00Z',
};
const metadata = () => ({
  generation: '123',
  timeCreated: '2026-10-01T00:00:00Z',
  metadata: { ownerUid: 'seller', mediaPolicy: 'listing-v1' },
});
function storageFixture(env = config) {
  const getMetadata = jest.fn().mockResolvedValue([metadata()]);
  const remove = jest.fn().mockResolvedValue(undefined);
  const file = jest.fn().mockReturnValue({ getMetadata, delete: remove });
  const storage = new ListingCleanupStorage(
    { name: photo.bucket, file } as any,
    env,
  );
  return { storage, getMetadata, remove, file };
}

test('deletes only the inspected object generation', async () => {
  const { storage, remove } = storageFixture();
  const generation = await storage.inspect(photo, 'seller');
  expect(generation).toBe('123');
  await storage.remove(photo, generation);
  expect(remove).toHaveBeenCalledWith({ ifGenerationMatch: '123' });
});

test.each([
  [{ ...photo, bucket: 'foreign.appspot.com' }, 'seller'],
  [{ ...photo, name: 'products/seller/a.jpg' }, 'seller'],
  [photo, 'other-user'],
])('preserves foreign and legacy objects', async (candidate, uid) => {
  const { storage, file } = storageFixture();
  expect(await storage.inspect(candidate as typeof photo, uid as string)).toBe(
    'review',
  );
  expect(file).not.toHaveBeenCalled();
});

test.each([
  { ...metadata(), timeCreated: '2025-01-01T00:00:00Z' },
  { ...metadata(), metadata: { ownerUid: 'other', mediaPolicy: 'listing-v1' } },
  { ...metadata(), generation: undefined },
])('preserves objects with unverifiable metadata', async (data) => {
  const { storage, getMetadata } = storageFixture();
  getMetadata.mockResolvedValue([data]);
  expect(await storage.inspect(photo, 'seller')).toBe('review');
});

test('missing objects are idempotent; replacement generations are never force-deleted', async () => {
  const { storage, getMetadata, remove } = storageFixture();
  getMetadata.mockRejectedValue({ code: 404 });
  expect(await storage.inspect(photo, 'seller')).toBe('missing');
  remove.mockRejectedValue({ code: 404 });
  await expect(storage.remove(photo, '123')).resolves.toBeUndefined();
  getMetadata.mockResolvedValue([metadata()]);
  remove.mockRejectedValue({ code: 412 });
  await expect(storage.remove(photo, '123')).rejects.toThrow(
    'STORAGE_GENERATION_CHANGED',
  );
  expect(remove).toHaveBeenCalledTimes(1);
});

const localEnv = {
  FIREBASE_PROJECT_ID: 'demo-cleanup',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9299',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8280',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9399',
};
test('worker CLI defaults to read-only and requires exact explicit target and write opt-in', () => {
  expect(
    cleanupArguments(['--project', 'demo-cleanup'], localEnv),
  ).toMatchObject({ apply: false, limit: 20 });
  expect(() => cleanupArguments(['--project', 'wrong'], localEnv)).toThrow();
  expect(
    cleanupArguments(['--project', 'demo-cleanup', '--apply'], localEnv),
  ).toMatchObject({ apply: true, limit: 20 });
  expect(() =>
    cleanupArguments(['--project', 'demo-cleanup', '--limit', '101'], localEnv),
  ).toThrow();
  expect(() =>
    cleanupArguments(['--project', 'demo-cleanup', '--retry', 'abc'], localEnv),
  ).toThrow();
  expect(() =>
    cleanupArguments(['--project', 'demo-cleanup'], {
      ...localEnv,
      FIREBASE_STORAGE_EMULATOR_HOST: '',
    }),
  ).toThrow();
  expect(cleanupArguments(['--project', 'demo-cleanup', '--apply'], localEnv).apply).toBe(true);
});
