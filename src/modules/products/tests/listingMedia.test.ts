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
beforeAll(async () => {
  bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
});
beforeEach(() => {
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
  delete process.env.LISTING_MEDIA_BUCKET;
  delete process.env.LISTING_MEDIA_POLICY_START;
  delete process.env.LISTING_MEDIA_RULES_VERIFIED;
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
