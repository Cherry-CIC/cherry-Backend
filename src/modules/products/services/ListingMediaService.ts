import { createHash } from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import type { Bucket } from '@google-cloud/storage';
import { ListingSafetyError } from '../../../shared/utils/listingSafety';

export const MAX_LISTING_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const invalid = (message: string): never => {
  throw new ListingSafetyError(400, 'LISTING_INVALID_MEDIA', message);
};

export class ListingMediaService {
  constructor(private readonly injectedBucket?: Bucket) {}

  async validate(
    ownerUid: string,
    urls: string[],
    retainedUrls: string[],
  ): Promise<void> {
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
    const bucket = this.injectedBucket ?? getStorage().bucket(bucketName);
    const objects = new Set<string>();
    // Sequential decoding bounds peak memory on the small Cloud Run instance.
    for (const raw of urls) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return invalid('Use an approved uploaded photo.');
      }
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'firebasestorage.googleapis.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.hash
      )
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
      if (objects.has(name) || /[\x00-\x1f]/.test(name))
        invalid('Each photo must be a distinct object.');
      objects.add(name);
      const newPrefix = `listing-media-v1/${ownerUid}/`;
      const legacyPrefix = `products/${ownerUid}/`;
      const retained = retainedUrls.includes(raw);
      const modern =
        name.startsWith(newPrefix) &&
        !name.slice(newPrefix.length).includes('/');
      const legacy =
        retained &&
        name.startsWith(legacyPrefix) &&
        !name.slice(legacyPrefix.length).includes('/');
      if (!modern && !legacy)
        invalid('This photo does not belong to this listing owner.');
      try {
        const file = bucket.file(name);
        const [metadata] = await file.getMetadata();
        if (legacy) {
          // Historical permissive rules mean a path is not evidence of who
          // uploaded it. Only an operator-verified, server-owned record counts.
          const key: string = createHash('sha256')
            .update(`${bucketName}/${name}`)
            .digest('hex');
          const provenance: FirebaseFirestore.DocumentData | undefined = (
            await getFirestore()
              .collection('listing_media_ownership')
              .doc(key)
              .get()
          ).data();
          if (
            !provenance ||
            provenance.ownerUid !== ownerUid ||
            provenance.bucket !== bucketName ||
            provenance.path !== name ||
            String(provenance.generation) !== String(metadata.generation)
          )
            invalid('This retained photo needs an ownership review.');
        }
        const size = Number(metadata.size);
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PHOTO_BYTES)
          invalid('Each photo must be no larger than 10 MiB.');
        const types: Record<string, string> = {
          'image/jpeg': 'jpeg',
          'image/png': 'png',
          'image/webp': 'webp',
        };
        if (!metadata.contentType || !types[metadata.contentType])
          invalid('Use JPEG, PNG or WebP photos.');
        // New namespace was empty at rule deployment. These fields are immutable
        // and enforced at authenticated creation, not trusted client assertions.
        if (
          modern &&
          (!metadata.timeCreated ||
            !Number.isFinite(Date.parse(metadata.timeCreated)) ||
            Date.parse(metadata.timeCreated) < policyStart ||
            metadata.metadata?.ownerUid !== ownerUid ||
            metadata.metadata?.mediaPolicy !== 'listing-v1')
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
        // Pin the immutable generation and bound the read even if trusted storage
        // configuration has accidentally changed since metadata was inspected.
        const chunks: Buffer[] = [];
        let bytes = 0;
        const pinned = bucket.file(name, { generation: metadata.generation });
        for await (const chunk of pinned.createReadStream({
          start: 0,
          end: MAX_PHOTO_BYTES,
        })) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > MAX_PHOTO_BYTES) invalid('Photo is too large.');
          chunks.push(buffer);
        }
        if (bytes !== size) invalid('Photo changed during validation.');
        const buffer = Buffer.concat(chunks);
        const decoder = sharp(buffer, {
          limitInputPixels: MAX_PIXELS,
          failOn: 'warning',
        });
        const info = await decoder.metadata();
        if (
          info.format !== types[metadata.contentType!] ||
          (info.pages ?? 1) !== 1
        )
          invalid('Use a valid, non-animated photo.');
        // Force pixel decoding, not just a file header check.
        await decoder.resize(1, 1).raw().toBuffer();
      } catch (error) {
        if (error instanceof ListingSafetyError) throw error;
        invalid('The photo is missing, unreadable or invalid.');
      }
    }
  }
}
