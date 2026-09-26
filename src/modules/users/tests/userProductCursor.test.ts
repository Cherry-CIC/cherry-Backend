import { createCipheriv, randomBytes } from 'crypto';
import {
  InvalidUserProductCursor,
  UserProductCursor,
} from '../services/UserProductCursor';

const key = Buffer.alloc(32, 7).toString('base64');
const now = 1700000000000;
const position = {
  seconds: 1700000000,
  nanoseconds: 123456789,
  id: 'listing-id',
};
const codec = () =>
  new UserProductCursor(
    () => key,
    () => now,
  );

const encryptedPayload = (
  payload: object,
  policy = 'profile:active-stock-permitted:v1',
) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    nonce,
  );
  cipher.setAAD(Buffer.from(JSON.stringify([policy, 'seller', 'viewer'])));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString(
    'base64url',
  );
};

describe('UserProductCursor', () => {
  it('round-trips an opaque position without losing nanoseconds', () => {
    const cursor = codec().encode(position, 'seller', 'viewer');
    expect(codec().decode(cursor, 'seller', 'viewer')).toEqual(position);
    expect(Buffer.from(cursor, 'base64url').toString()).not.toContain(
      'listing-id',
    );
    expect(codec().encode(position, 'seller', 'viewer')).not.toBe(cursor);
  });

  it.each([
    ['other-seller', 'viewer'],
    ['seller', 'other-viewer'],
  ])(
    'rejects a cursor outside its seller/viewer scope (%s, %s)',
    (owner, viewer) => {
      const token = codec().encode(position, 'seller', 'viewer');
      expect(() => codec().decode(token, owner, viewer)).toThrow(
        InvalidUserProductCursor,
      );
    },
  );

  it('rejects cryptographic tampering even with valid base64url syntax', () => {
    const bytes = Buffer.from(
      codec().encode(position, 'seller', 'viewer'),
      'base64url',
    );
    bytes[bytes.length - 2] ^= 1;
    expect(() =>
      codec().decode(bytes.toString('base64url'), 'seller', 'viewer'),
    ).toThrow(InvalidUserProductCursor);
  });

  it('rejects cursors signed under an obsolete visibility policy', () => {
    const token = encryptedPayload(
      { ...position, expires: now / 1000 + 86400 },
      'old-policy',
    );
    expect(() => codec().decode(token, 'seller', 'viewer')).toThrow(
      InvalidUserProductCursor,
    );
  });

  it('rejects a cursor after expiry or key rotation', () => {
    const token = codec().encode(position, 'seller', 'viewer');
    expect(() =>
      new UserProductCursor(
        () => key,
        () => now + 86400000,
      ).decode(token, 'seller', 'viewer'),
    ).toThrow(InvalidUserProductCursor);
    expect(() =>
      new UserProductCursor(
        () => Buffer.alloc(32, 8).toString('base64'),
        () => now,
      ).decode(token, 'seller', 'viewer'),
    ).toThrow(InvalidUserProductCursor);
  });

  it.each([
    '',
    'malformed',
    'A'.repeat(39),
    'A'.repeat(4097),
    'A'.repeat(100) + '=',
    'A'.repeat(100),
  ])('rejects malformed input', (token) => {
    expect(() => codec().decode(token, 'seller', 'viewer')).toThrow(
      InvalidUserProductCursor,
    );
  });

  it.each([
    { seconds: '1700000000' },
    { seconds: 253402300800 },
    { seconds: -62135596801 },
    { nanoseconds: -1 },
    { nanoseconds: 1000000000 },
    { nanoseconds: 1.5 },
    { id: '' },
    { id: '../secret' },
    { id: 'a\\b' },
    { id: '\u0000' },
    { id: '..' },
    { id: 'x'.repeat(1501) },
    { expires: now / 1000 },
    { expires: now / 1000 + 86401 },
  ])('rejects invalid decrypted payload values: %j', (override) => {
    const token = encryptedPayload({
      ...position,
      expires: now / 1000 + 86400,
      ...override,
    });
    expect(() => codec().decode(token, 'seller', 'viewer')).toThrow(
      InvalidUserProductCursor,
    );
  });

  it.each([undefined, '', 'not-a-secret', Buffer.alloc(16).toString('base64')])(
    'fails operationally when the deployment key is missing or invalid',
    (secret) => {
      expect(() =>
        new UserProductCursor(() => secret).decode(
          undefined,
          'seller',
          'viewer',
        ),
      ).toThrow('User products cursor key is not configured');
    },
  );

  it('accepts the first page without a token', () => {
    expect(codec().decode(undefined, 'seller', 'viewer')).toBeUndefined();
  });
});
