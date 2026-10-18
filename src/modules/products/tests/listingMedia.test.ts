import { Readable } from 'stream';
import sharp from 'sharp';
import {
  ListingMediaService,
  MAX_PHOTO_BYTES,
} from '../services/ListingMediaService';

const bucketName = 'demo-cherry-listing.appspot.com';
const photoUrl = (name = 'listing-media-v1/seller/test.png') =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(name)}?alt=media&token=token`;
const originalEnv = { ...process.env };
const emulatorEnv = {
  NODE_ENV: 'development',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
};
let png: Buffer;
let bytes: Buffer;
let metadata: any;
let bucket: any;
let read: jest.Mock;

beforeAll(async () => {
  png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
});

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: 'test' };
  for (const key of [
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
    'STORAGE_EMULATOR_HOST',
  ])
    delete process.env[key];
  process.env.LISTING_MEDIA_BUCKET = bucketName;
  process.env.LISTING_MEDIA_POLICY_START = '2026-01-01T00:00:00Z';
  process.env.LISTING_MEDIA_RULES_VERIFIED = 'true';
  bytes = png;
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
  read = jest.fn(() => Readable.from([bytes]));
  bucket = {
    file: jest.fn(() => ({
      getMetadata: async () => [metadata],
      createReadStream: read,
    })),
  };
});

afterEach(() => {
  jest.useRealTimers();
  process.env = originalEnv;
});

const validate = (urls = [photoUrl()], uid = 'seller') =>
  new ListingMediaService(bucket).validatePhotos(urls, uid);
const invalidMedia = { status: 400, code: 'LISTING_INVALID_MEDIA' };

test.each(['png', 'jpeg', 'webp'] as const)(
  'decodes a valid owned %s photo and pins its generation',
  async (format) => {
    bytes = await sharp(png).toFormat(format).toBuffer();
    metadata.size = bytes.length;
    metadata.contentType = `image/${format}`;
    await expect(
      validate([photoUrl(`listing-media-v1/seller/test.${format}`)]),
    ).resolves.toBeUndefined();
    expect(bucket.file).toHaveBeenCalledWith(
      `listing-media-v1/seller/test.${format}`,
      { generation: '1' },
    );
    expect(read).toHaveBeenCalledWith({ start: 0, end: MAX_PHOTO_BYTES });
  },
);

test.each([
  'https://evil.example/image.png',
  photoUrl().replace(
    'firebasestorage.googleapis.com',
    'firebasestorage.googleapis.com.evil.example',
  ),
  photoUrl().replace('https:', 'http:'),
  photoUrl().replace('https://', 'https://user@'),
  photoUrl().replace(bucketName, 'another-bucket.appspot.com'),
  photoUrl() + '#fragment',
  photoUrl() + '&generation=123',
  photoUrl() + '&token=other',
  photoUrl() + '&alt=media',
  photoUrl().replace('&token=token', ''),
  photoUrl('listing-media-v1/other/test.png'),
  photoUrl('products/seller/old.png'),
  photoUrl('user_images/seller/test.png'),
  photoUrl('listing-media-v1/seller/nested/test.png'),
  photoUrl('listing-media-v1/seller/../test.png'),
  photoUrl('listing-media-v1/seller/test.svg'),
  photoUrl('listing-media-v1/seller/test%2epng'),
  photoUrl('listing-media-v1/seller/test\u0000.png'),
  photoUrl().replace('listing-media-v1', '%GG'),
  ` ${photoUrl()}`,
])(
  'rejects unapproved or unsafe URL before reading Storage: %s',
  async (url) => {
    await expect(validate([url])).rejects.toMatchObject(invalidMedia);
    expect(bucket.file).not.toHaveBeenCalled();
  },
);

test.each([
  { timeCreated: '2025-01-01T00:00:00Z' },
  { timeCreated: 'invalid' },
  { timeCreated: undefined },
  { generation: undefined },
  { generation: 'invalid' },
  { contentType: 'image/svg+xml' },
  { contentEncoding: 'gzip' },
  { size: MAX_PHOTO_BYTES + 1 },
  { size: 0 },
  { size: 'invalid' },
  { metadata: { ownerUid: 'other', mediaPolicy: 'listing-v1' } },
  { metadata: { ownerUid: 'seller', mediaPolicy: 'wrong-policy' } },
  { metadata: undefined },
])('rejects unverified or invalid metadata %j', async (change) => {
  metadata = { ...metadata, ...change };
  await expect(validate()).rejects.toMatchObject(invalidMedia);
  expect(read).not.toHaveBeenCalled();
});

test('does not accept the owner path alone, or a forged download token', async () => {
  await expect(
    validate([photoUrl().replace('token=token', 'token=forged')]),
  ).rejects.toMatchObject(invalidMedia);
  delete metadata.metadata.ownerUid;
  await expect(validate()).rejects.toMatchObject(invalidMedia);
  expect(read).not.toHaveBeenCalled();
});

test.each([
  { LISTING_MEDIA_BUCKET: '' },
  { LISTING_MEDIA_POLICY_START: '' },
  { LISTING_MEDIA_POLICY_START: 'invalid' },
  { LISTING_MEDIA_RULES_VERIFIED: 'false' },
])(
  'fails closed until the approved media policy is configured: %j',
  async (change) => {
    Object.assign(process.env, change);
    await expect(validate()).rejects.toMatchObject({
      status: 503,
      code: 'LISTING_MEDIA_NOT_READY',
    });
    expect(bucket.file).not.toHaveBeenCalled();
  },
);

test('requires distinct objects and between one and ten photos', async () => {
  await expect(validate([])).rejects.toMatchObject(invalidMedia);
  await expect(validate(Array(11).fill(photoUrl()))).rejects.toMatchObject(
    invalidMedia,
  );
  await expect(
    validate([
      photoUrl(),
      photoUrl().replace('alt=media&token=token', 'token=token&alt=media'),
    ]),
  ).rejects.toMatchObject(invalidMedia);
  await expect(
    validate(
      Array.from({ length: 10 }, (_, i) =>
        photoUrl(`listing-media-v1/seller/photo_${i}.png`),
      ),
    ),
  ).resolves.toBeUndefined();
});

test.each(['', 'seller/other', 'seller\\other', 'seller\u0000'])(
  'refuses an invalid owner UID %s',
  async (uid) => {
    await expect(validate([photoUrl()], uid)).rejects.toMatchObject(
      invalidMedia,
    );
    expect(bucket.file).not.toHaveBeenCalled();
  },
);

test.each(['fake', 'truncated', 'wrong-type', 'changed-size', 'too-large'])(
  'rejects %s content despite valid owner metadata',
  async (condition) => {
    if (condition === 'fake') bytes = Buffer.from('not an image');
    if (condition === 'truncated')
      bytes = png.subarray(0, Math.floor(png.length / 2));
    if (condition === 'wrong-type') metadata.contentType = 'image/jpeg';
    metadata.size = bytes.length;
    if (condition === 'changed-size') metadata.size += 1;
    if (condition === 'too-large') bytes = Buffer.alloc(MAX_PHOTO_BYTES + 1);
    await expect(validate()).rejects.toMatchObject(invalidMedia);
  },
);

test('rejects animated WebP photos', async () => {
  const second = await sharp(png).negate().png().toBuffer();
  bytes = await sharp([png, second], { join: { animated: true } })
    .webp()
    .toBuffer();
  metadata.size = bytes.length;
  metadata.contentType = 'image/webp';
  expect((await sharp(bytes).metadata()).pages).toBe(2);
  await expect(
    validate([photoUrl('listing-media-v1/seller/animated.webp')]),
  ).rejects.toMatchObject(invalidMedia);
});

test('bounds image dimensions before pixel decoding', async () => {
  // Adjust a PNG header to exceed 40 MP. Recalculate its IHDR CRC so the
  // decoder sees the declared dimensions rather than failing a checksum first.
  bytes = Buffer.from(png);
  bytes.writeUInt32BE(10000, 16);
  bytes.writeUInt32BE(5000, 20);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  await expect(validate()).rejects.toMatchObject(invalidMedia);
});

test('reports missing objects without exposing Storage details', async () => {
  bucket.file.mockImplementation(() => ({
    getMetadata: async () => {
      throw new Error('private internal object detail');
    },
  }));
  await expect(validate()).rejects.toMatchObject({
    ...invalidMedia,
    message: 'The photo is missing, unreadable or invalid.',
  });
});

test('terminates a stalled read', async () => {
  jest.useFakeTimers();
  const stalled = new Readable({ read() {} });
  read.mockReturnValue(stalled);
  const assertion = expect(validate()).rejects.toMatchObject(invalidMedia);
  await jest.advanceTimersByTimeAsync(15001);
  await assertion;
  expect(stalled.destroyed).toBe(true);
});

test('allows only the exact local Storage origin when all three emulators are guarded', async () => {
  const localUrl = photoUrl().replace(
    'https://firebasestorage.googleapis.com',
    'http://127.0.0.1:9199',
  );
  await expect(validate([localUrl])).rejects.toMatchObject(invalidMedia);
  Object.assign(process.env, emulatorEnv);
  await expect(validate([localUrl])).resolves.toBeUndefined();
  await expect(validate()).rejects.toMatchObject(invalidMedia);
  await expect(
    validate([localUrl.replace(':9199', ':9298')]),
  ).rejects.toMatchObject(invalidMedia);
});

test('refuses partial emulator configuration and production emulator access', async () => {
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  await expect(validate()).rejects.toThrow('together');
  Object.assign(process.env, emulatorEnv, { NODE_ENV: 'production' });
  await expect(validate()).rejects.toThrow('must not be enabled in production');
  expect(bucket.file).not.toHaveBeenCalled();
});
