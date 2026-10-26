import { createHash } from 'node:crypto';
import { ListingSafetyError } from '../../../shared/utils/listingSafety';

export const MEDIA_RETIREMENTS = 'listing_media_retirements';
export interface MediaObject {
  bucket: string;
  name: string;
}

/** Identity only: a URL, path or client metadata is never proof of ownership. */
export function canonicalMedia(value: unknown): MediaObject | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    let bucket: string;
    let name: string;
    const firebase = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    const google = url.pathname.match(
      /^\/(?:download\/)?storage\/v1\/b\/([^/]+)\/o\/(.+)$/,
    );
    if (
      firebase &&
      (url.hostname === 'firebasestorage.googleapis.com' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) {
      bucket = decodeURIComponent(firebase[1]);
      name = decodeURIComponent(firebase[2]);
    } else if (google && url.hostname === 'storage.googleapis.com') {
      bucket = decodeURIComponent(google[1]);
      name = decodeURIComponent(google[2]);
    } else if (url.protocol === 'gs:') {
      bucket = url.hostname;
      name = decodeURIComponent(url.pathname.slice(1));
    } else if (
      ['storage.googleapis.com', 'storage.cloud.google.com'].includes(
        url.hostname,
      )
    ) {
      const parts = url.pathname.slice(1).split('/');
      bucket = decodeURIComponent(parts.shift() ?? '');
      name = decodeURIComponent(parts.join('/'));
    } else if (url.hostname.endsWith('.storage.googleapis.com')) {
      bucket = url.hostname.slice(0, -'.storage.googleapis.com'.length);
      name = decodeURIComponent(url.pathname.slice(1));
    } else return null;
    if (
      !bucket ||
      !name ||
      /[/\\\x00-\x1f]/.test(bucket) ||
      /[\x00-\x1f]/.test(name)
    )
      return null;
    return { bucket, name };
  } catch {
    return null;
  }
}

export function mediaKey(photo: MediaObject): string {
  return createHash('sha256')
    .update(`${photo.bucket}\0${photo.name}`)
    .digest('hex');
}

export function photoManifest(values: unknown): {
  photos: MediaObject[];
  unverifiedPhotos: number;
} {
  if (!Array.isArray(values)) return { photos: [], unverifiedPhotos: 1 };
  const photos = new Map<string, MediaObject>();
  let unverifiedPhotos = Math.max(0, values.length - 100);
  for (const value of values.slice(0, 100)) {
    const photo = canonicalMedia(value);
    if (photo) photos.set(mediaKey(photo), photo);
    else unverifiedPhotos++;
  }
  return { photos: [...photos.values()], unverifiedPhotos };
}

/** All listing writers read the same retirement documents, even with editing off. */
export async function guardListingMedia(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  values: unknown,
): Promise<void> {
  const { photos } = photoManifest(values);
  if (Array.isArray(values) && values.length > 100)
    throw new ListingSafetyError(
      400,
      'LISTING_INVALID_MEDIA',
      'Too many listing photos.',
    );
  const states = await Promise.all(
    photos.map((photo) =>
      tx.get(db.collection(MEDIA_RETIREMENTS).doc(mediaKey(photo))),
    ),
  );
  if (states.some((doc) => ['retiring', 'retired'].includes(doc.get('state'))))
    throw new ListingSafetyError(
      409,
      'LISTING_MEDIA_RETIRED',
      'A photo is no longer available. Upload it again.',
    );
}

/** Includes legacy URL aliases and nested order snapshots without logging tokens. */
export function referencesMedia(value: unknown, photo: MediaObject): boolean {
  if (typeof value === 'string') {
    const parsed = canonicalMedia(value);
    return (
      value === photo.name || (!!parsed && mediaKey(parsed) === mediaKey(photo))
    );
  }
  if (Array.isArray(value))
    return value.some((entry) => referencesMedia(entry, photo));
  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return Object.values(value).some((entry) => referencesMedia(entry, photo));
  return false;
}
