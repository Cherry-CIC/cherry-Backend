import { photoManifest, MediaObject } from './media';

export const DELETION_JOBS = 'listing_deletion_jobs';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MEDIA_GRACE_MS = 30 * DAY_MS;
export const RECEIPT_RETENTION_MS = 30 * DAY_MS;
export interface DeletionJob {
  productId: string;
  ownerUid: string;
  photos: MediaObject[];
  unverifiedPhotos: number;
  createdAt: Date;
  notBefore: Date;
  nextAttemptAt?: Date;
  status: 'pending' | 'processing' | 'waiting' | 'review' | 'completed';
  attempts: number;
  likesDone: boolean;
  leaseToken?: string;
  leaseUntil?: Date;
  completedAt?: Date;
  lastError?: string;
}

export function newDeletionJob(
  productId: string,
  ownerUid: string,
  values: unknown,
  now = new Date(),
): DeletionJob {
  return {
    productId,
    ownerUid,
    ...photoManifest(values),
    createdAt: now,
    notBefore: new Date(now.getTime() + MEDIA_GRACE_MS),
    nextAttemptAt: now,
    status: 'pending',
    attempts: 0,
    likesDone: false,
  };
}
