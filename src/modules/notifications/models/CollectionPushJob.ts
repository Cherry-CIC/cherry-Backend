import { createHash } from 'crypto';

export const collectionPushJobId = (shipmentId: string): string =>
  createHash('sha256').update(shipmentId).digest('hex');

export const COLLECTION_PUSH_JOBS = 'collectionPushJobs';

export interface CollectionPushJob {
  eventId: string;
  shipmentId: string;
  orderId: string;
  userId: string;
  status: 'pending' | 'sending' | 'complete' | 'cancelled' | 'failed';
  attempts: number;
  deliveredDeviceIds: string[];
  createdAt: Date;
  expiresAt: Date;
  nextAttemptAt?: Date;
  leaseId?: string;
}

export function newCollectionPushJob(shipmentId: string, orderId: string, userId: string, now: Date): CollectionPushJob {
  return {
    eventId: collectionPushJobId(shipmentId), shipmentId, orderId, userId,
    status: 'pending', attempts: 0, deliveredDeviceIds: [], createdAt: now,
    // This is queue retention, not a buyer-facing collection deadline.
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), nextAttemptAt: now,
  };
}
