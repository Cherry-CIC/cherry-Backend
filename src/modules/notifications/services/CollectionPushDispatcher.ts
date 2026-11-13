import { getMessaging, Message } from 'firebase-admin/messaging';
import { CollectionPushRepository } from '../repositories/CollectionPushRepository';
import { CollectionPushJob } from '../models/CollectionPushJob';

const INVALID_TOKENS = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

export class CollectionPushDispatcher {
  constructor(
    private readonly repository = new CollectionPushRepository(),
    private readonly send: (message: Message) => Promise<string> = message => getMessaging().send(message),
    private readonly now: () => Date = () => new Date(),
    private readonly enabled: () => boolean = () => process.env.COLLECTION_PUSH_ENABLED === 'true',
  ) {}

  async runBatch(limit = 20): Promise<{ enabled: boolean; claimed: number }> {
    if (!this.enabled()) return { enabled: false, claimed: 0 };
    const batchSize = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
    const ids = await this.repository.dueIds(this.now(), batchSize);
    let claimed = 0;
    for (const id of ids) {
      const job = await this.repository.claim(id, this.now());
      if (!job) continue;
      claimed++;
      try { await this.dispatch(job); }
      catch {
        // A failed write leaves the lease to expire for a later worker run.
        // Never log registration tokens, notification payloads or provider errors.
        await this.repository.retry(job, this.now()).catch(() => undefined);
      }
    }
    return { enabled: true, claimed };
  }

  private async dispatch(job: CollectionPushJob): Promise<void> {
    if (!await this.repository.eligible(job, this.now())) {
      await this.repository.finish(job, 'cancelled'); return;
    }
    const devices = await this.repository.devices(job.userId, this.now());
    if (!devices.length) { await this.repository.retry(job, this.now()); return; }
    let retry = false;
    for (const device of devices) {
      if (job.deliveredDeviceIds.includes(device.id)) continue;
      if (!await this.repository.renewAndCheckDevice(job, device, this.now())) {
        // A lease may expire during a slow provider call. A fresh worker must
        // retry unsent devices rather than treating them as delivered.
        retry = true; continue;
      }
      const eligibility = await this.repository.eligible(job, this.now());
      if (!eligibility) { await this.repository.finish(job, 'cancelled'); return; }
      const expiresAt = Math.min(job.expiresAt.getTime(), eligibility.deadline?.getTime() ?? Infinity,
        this.now().getTime() + 60 * 60 * 1000);
      if (expiresAt <= this.now().getTime()) {
        await this.repository.finish(job, 'cancelled'); return;
      }
      try {
        await this.send({
          token: device.token,
          notification: { title: 'Ready to collect', body: 'Your parcel is ready at your InPost locker. Open cherry for collection details.' },
          data: { type: 'ready_to_collect', orderId: job.orderId, userId: job.userId, eventId: job.eventId },
          android: { priority: 'high', ttl: Math.max(0, expiresAt - this.now().getTime()),
            collapseKey: job.eventId, notification: { tag: job.eventId } },
          apns: { headers: { 'apns-collapse-id': job.eventId, 'apns-expiration': String(Math.floor(expiresAt / 1000)),
            'apns-push-type': 'alert', 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
        });
        await this.repository.delivered(job, device.id);
      } catch (error: any) {
        if (INVALID_TOKENS.has(error?.code)) await this.repository.removeInvalidDevice(job, device);
        else retry = true;
      }
    }
    if (retry) await this.repository.retry(job, this.now());
    else await this.repository.finish(job, 'complete');
  }
}
