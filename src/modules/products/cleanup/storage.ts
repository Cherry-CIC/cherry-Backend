import { getStorage } from 'firebase-admin/storage';
import type { Bucket } from '@google-cloud/storage';
import { MediaObject } from './media';

export interface CleanupStorage {
  inspect(
    photo: MediaObject,
    ownerUid: string,
  ): Promise<string | 'missing' | 'review'>;
  remove(photo: MediaObject, generation: string): Promise<void>;
}

export class ListingCleanupStorage implements CleanupStorage {
  constructor(
    private readonly bucket?: Bucket,
    private readonly env = process.env,
  ) {}

  async inspect(
    photo: MediaObject,
    ownerUid: string,
  ): Promise<string | 'missing' | 'review'> {
    const cutoff = Date.parse(this.env.LISTING_MEDIA_POLICY_START ?? '');
    const [namespace, owner, filename, extra] = photo.name.split('/');
    if (
      photo.bucket !== this.env.LISTING_MEDIA_BUCKET ||
      !Number.isFinite(cutoff) ||
      namespace !== 'listing-media-v1' ||
      owner !== ownerUid ||
      extra !== undefined ||
      !filename ||
      !/^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(filename)
    )
      return 'review';
    try {
      const [metadata] = await this.getBucket(photo)
        .file(photo.name)
        .getMetadata();
      if (
        !metadata.timeCreated ||
        !Number.isFinite(Date.parse(metadata.timeCreated)) ||
        Date.parse(metadata.timeCreated) < cutoff ||
        metadata.metadata?.ownerUid !== ownerUid ||
        metadata.metadata?.mediaPolicy !== 'listing-v1' ||
        !/^[1-9][0-9]*$/.test(String(metadata.generation ?? ''))
      )
        return 'review';
      return String(metadata.generation);
    } catch (error) {
      if ((error as { code?: number }).code === 404) return 'missing';
      throw new Error('STORAGE_INSPECTION_FAILED');
    }
  }

  async remove(photo: MediaObject, generation: string): Promise<void> {
    if (
      photo.bucket !== this.env.LISTING_MEDIA_BUCKET ||
      !/^[1-9][0-9]*$/.test(generation)
    )
      throw new Error('STORAGE_CLEANUP_DISABLED');
    try {
      const file = this.getBucket(photo).file(photo.name);
      // Check again at the adapter boundary, then let the provider enforce the
      // same condition atomically. The emulator does not enforce that condition.
      const [current] = await file.getMetadata();
      if (String(current.generation) !== generation)
        throw new Error('STORAGE_GENERATION_CHANGED');
      await file.delete({ ifGenerationMatch: generation });
    } catch (error) {
      if ((error as { code?: number }).code === 404) return;
      // A replacement object must never be deleted by retrying without the precondition.
      if (
        (error as { code?: number }).code === 412 ||
        (error as Error).message === 'STORAGE_GENERATION_CHANGED'
      )
        throw new Error('STORAGE_GENERATION_CHANGED');
      throw new Error('STORAGE_DELETION_FAILED');
    }
  }

  private getBucket(photo: MediaObject): Bucket {
    if (this.bucket && this.bucket.name !== photo.bucket)
      throw new Error('STORAGE_BUCKET_MISMATCH');
    return this.bucket ?? getStorage().bucket(photo.bucket);
  }
}
