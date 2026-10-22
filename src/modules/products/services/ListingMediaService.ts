import { getStorage } from 'firebase-admin/storage';
import type { Bucket } from '@google-cloud/storage';
import sharp from 'sharp';
import { localFirebaseEmulators } from '../../../shared/config/firebaseEmulators';
import { ListingSafetyError } from '../../../shared/utils/listingSafety';

export const MAX_LISTING_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 40_000_000;
const PHOTO_READ_TIMEOUT_MS = 15_000;
const imageFormats: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const invalid = (message: string): never => {
  throw new ListingSafetyError(400, 'LISTING_INVALID_MEDIA', message);
};

export class ListingMediaService {
  constructor(private readonly injectedBucket?: Bucket) {}

  /**
   * Only immutable uploads made after verified owner-enforcing rules qualify.
   * Existing listing URLs do not establish ownership of legacy uploads.
   */
  async validatePhotos(urls: string[], ownerUid: string): Promise<void> {
    const bucketName = process.env.LISTING_MEDIA_BUCKET;
    const policyStart = Date.parse(
      process.env.LISTING_MEDIA_POLICY_START ?? '',
    );
    if (
      !bucketName ||
      !Number.isFinite(policyStart) ||
      process.env.LISTING_MEDIA_RULES_VERIFIED !== 'true'
    ) {
      throw new ListingSafetyError(
        503,
        'LISTING_MEDIA_NOT_READY',
        'Photo validation is not available yet.',
      );
    }
    if (
      !Array.isArray(urls) ||
      urls.length < 1 ||
      urls.length > MAX_LISTING_PHOTOS
    )
      invalid('Use between 1 and 10 photos.');
    if (!ownerUid || ownerUid.length > 128 || /[/\\\x00-\x1f]/.test(ownerUid))
      invalid('Photo ownership could not be verified.');

    const emulators = localFirebaseEmulators();
    const bucket = this.injectedBucket ?? getStorage().bucket(bucketName);
    const objects = new Set<string>();
    // Decode sequentially to bound peak memory on the Cloud Run instance.
    for (const raw of urls) {
      let url: URL;
      try {
        if (typeof raw !== 'string' || raw !== raw.trim())
          invalid('Use an approved uploaded photo.');
        url = new URL(raw);
      } catch {
        return invalid('Use an approved uploaded photo.');
      }
      const approvedOrigin = emulators
        ? url.origin === emulators.storageOrigin
        : url.origin === 'https://firebasestorage.googleapis.com';
      if (!approvedOrigin || url.username || url.password || url.hash)
        invalid('Use an approved uploaded photo.');
      if (
        [...url.searchParams.keys()].some(
          (key) => !['alt', 'token'].includes(key),
        ) ||
        url.searchParams.getAll('alt').length !== 1 ||
        url.searchParams.getAll('token').length !== 1
      )
        invalid('Photo URL parameters are invalid.');

      const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
      if (!match) invalid('Invalid photo URL.');
      let name: string;
      try {
        if (decodeURIComponent(match![1]) !== bucketName)
          invalid('Photo bucket is not approved.');
        name = decodeURIComponent(match![2]);
      } catch {
        return invalid('Invalid photo path.');
      }
      const [namespace, owner, filename, extra] = name.split('/');
      if (
        namespace !== 'listing-media-v1' ||
        owner !== ownerUid ||
        extra !== undefined ||
        !filename ||
        !/^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(filename)
      )
        invalid('Upload this photo again so its ownership can be verified.');
      if (objects.has(name)) invalid('Each photo must be a distinct object.');
      objects.add(name);

      try {
        const [metadata] = await bucket.file(name).getMetadata();
        const size = Number(metadata.size);
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PHOTO_BYTES)
          invalid('Each photo must be no larger than 10 MiB.');
        if (!metadata.contentType || !imageFormats[metadata.contentType])
          invalid('Use JPEG, PNG or WebP photos.');
        if (metadata.contentEncoding && metadata.contentEncoding !== 'identity')
          invalid('Compressed photo uploads are not supported.');
        // These fields are trusted only because create-only Storage rules bind
        // them to authenticated ownership. The namespace must be audited before
        // the policy cutoff; client-set metadata alone is not proof of ownership.
        if (
          !metadata.timeCreated ||
          !Number.isFinite(Date.parse(metadata.timeCreated)) ||
          Date.parse(metadata.timeCreated) < policyStart ||
          metadata.metadata?.ownerUid !== ownerUid ||
          metadata.metadata?.mediaPolicy !== 'listing-v1' ||
          !/^[1-9][0-9]*$/.test(String(metadata.generation ?? ''))
        )
          invalid('Photo ownership could not be verified.');
        if (
          url.searchParams.get('alt') !== 'media' ||
          !url.searchParams.get('token') ||
          !String(metadata.metadata?.firebaseStorageDownloadTokens ?? '')
            .split(',')
            .includes(url.searchParams.get('token')!)
        )
          invalid('Photo download URL is invalid.');

        // Pin the inspected object generation and bound both bytes and time.
        const stream = bucket
          .file(name, { generation: metadata.generation })
          .createReadStream({ start: 0, end: MAX_PHOTO_BYTES });
        const timeout = setTimeout(
          () => stream.destroy(new Error('Photo read timed out.')),
          PHOTO_READ_TIMEOUT_MS,
        );
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
          for await (const chunk of stream) {
            const buffer = Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > MAX_PHOTO_BYTES) invalid('Photo is too large.');
            chunks.push(buffer);
          }
        } finally {
          clearTimeout(timeout);
          stream.destroy();
        }
        if (bytes !== size) invalid('Photo changed during validation.');
        const decoder = sharp(Buffer.concat(chunks), {
          limitInputPixels: MAX_PHOTO_PIXELS,
          failOn: 'warning',
        });
        const info = await decoder.metadata();
        if (
          info.format !== imageFormats[metadata.contentType!] ||
          (info.pages ?? 1) !== 1
        )
          invalid('Use a valid, non-animated photo.');
        // Decode all pixels, rather than accepting a valid-looking file header.
        await decoder.stats();
      } catch (error) {
        if (error instanceof ListingSafetyError) throw error;
        invalid('The photo is missing, unreadable or invalid.');
      }
    }
  }
}
