export const isLockerPushEnabled = (): boolean =>
  process.env.COLLECTION_PUSH_ENABLED === 'true';

export const LOCKER_COLLECTION_WINDOW_MS = 72 * 60 * 60 * 1000;
