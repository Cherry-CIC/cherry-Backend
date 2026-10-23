import { OrderRepository } from '../repositories/OrderRepository';
import { OrderReleaseTaskQueue } from './OrderReleaseTaskQueue';

export class OrderReleaseService {
  constructor(
    private readonly orderRepository = new OrderRepository(),
    private readonly queue = new OrderReleaseTaskQueue(),
  ) {}

  // Starts the hold when the carrier reports delivery and schedules the task
  // that releases the order once the hold expires. Returns when the hold ends,
  // or null when there is no hold. Never throws: a failure here must not fail
  // the carrier webhook, and a repeated delivery report or the reconciliation
  // run retries the scheduling.
  async startHoldOnDelivery(orderId: string): Promise<Date | null> {
    let releaseAt: Date | null = null;
    try {
      const recorded = await this.orderRepository.recordDelivery(orderId);
      releaseAt = recorded.releaseAt;

      if (releaseAt && recorded.releaseTaskPending) {
        await this.ensureReleaseTask(orderId, releaseAt);
      }
    } catch (err) {
      console.error(
        `Order ${orderId} hold started without a scheduled release task:`,
        err,
      );
    }
    return releaseAt;
  }

  // Scheduling is idempotent: the task name is derived from the order ID.
  async ensureReleaseTask(orderId: string, releaseAt: Date): Promise<void> {
    await this.queue.scheduleRelease(orderId, releaseAt);
    await this.orderRepository.markReleaseTaskEnqueued(orderId);
  }
}
