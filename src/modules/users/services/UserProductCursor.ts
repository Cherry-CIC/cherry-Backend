import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { UserProductPosition } from '../model/UserProfile';

// Change this whenever visible-product eligibility or ordering semantics change.
const POLICY = 'user-products:active-stock-permitted:v1';
const MAX_AGE_SECONDS = 24 * 60 * 60;

export class InvalidUserProductCursor extends Error {
  constructor() {
    super('Invalid cursor');
  }
}

/** Authenticated encryption keeps the position opaque and binds its scope. */
export class UserProductCursor {
  constructor(
    private readonly secret: () => string | undefined = () =>
      process.env.USER_PRODUCTS_CURSOR_KEY,
    private readonly now: () => number = Date.now,
  ) {}

  private key(): Buffer {
    const encoded = this.secret();
    if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
      throw new Error('User products cursor key is not configured');
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) {
      throw new Error('User products cursor key is not configured');
    }
    return key;
  }

  private scope(ownerId: string, viewerId: string): Buffer {
    return Buffer.from(JSON.stringify([POLICY, ownerId, viewerId]));
  }

  encode(
    position: UserProductPosition,
    ownerId: string,
    viewerId: string,
  ): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), nonce);
    cipher.setAAD(this.scope(ownerId, viewerId));
    const payload = JSON.stringify({
      ...position,
      expires: Math.floor(this.now() / 1000) + MAX_AGE_SECONDS,
    });
    const encrypted = Buffer.concat([
      cipher.update(payload, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
      'base64url',
    );
  }

  decode(
    token: string | undefined,
    ownerId: string,
    viewerId: string,
  ): UserProductPosition | undefined {
    // Missing configuration remains an operational error, not a bad cursor.
    const key = this.key();
    if (token === undefined) return undefined;
    try {
      if (!/^[A-Za-z0-9_-]{40,4096}$/.test(token)) throw new Error();
      const bytes = Buffer.from(token, 'base64url');
      if (bytes.toString('base64url') !== token) throw new Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(this.scope(ownerId, viewerId));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const payload = JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString('utf8'),
      );
      if (
        !payload ||
        !Number.isInteger(payload.seconds) ||
        payload.seconds < -62135596800 ||
        payload.seconds > 253402300799 ||
        !Number.isInteger(payload.nanoseconds) ||
        payload.nanoseconds < 0 ||
        payload.nanoseconds >= 1000000000 ||
        typeof payload.id !== 'string' ||
        !payload.id.trim() ||
        payload.id === '.' ||
        payload.id === '..' ||
        /[/\\\x00-\x1f\x7f-\x9f]/.test(payload.id) ||
        Buffer.byteLength(payload.id, 'utf8') > 1500 ||
        !Number.isInteger(payload.expires) ||
        payload.expires <= Math.floor(this.now() / 1000) ||
        payload.expires > Math.floor(this.now() / 1000) + MAX_AGE_SECONDS
      ) {
        throw new Error();
      }
      return {
        seconds: payload.seconds,
        nanoseconds: payload.nanoseconds,
        id: payload.id,
      };
    } catch {
      throw new InvalidUserProductCursor();
    }
  }
}
