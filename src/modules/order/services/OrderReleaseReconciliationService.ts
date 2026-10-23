import { OrderRepository } from '../repositories/OrderRepository';
import { OrderReleaseService } from './OrderReleaseService';

export const DEFAULT_RECONCILE_LIMIT = 200;
export const MAX_RECONCILE_LIMIT = 1000;
const PAGE_SIZE = 100;

export interface ReconciliationSummary {
  scanned: number;
  released: number;
  alreadyReleased: number;
  blocked: number;
  tasksScheduled: number;
  errors: number;
}

// null means invalid; undefined falls back to the default.
export const parseReconcileLimit = (value: unknown): number | null => {
  if (value === undefined) {
    return DEFAULT_RECONCILE_LIMIT;
  }
  return Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_RECONCILE_LIMIT
    ? (value as number)
    : null;
};

// Safety net for the Cloud Tasks release path. It releases orders that are past
// their release time (a lost task, or a hold lifted after the task ran) and
// schedules a task for held orders that never got one. Both read only orders
// with autoReleaseAt set, which is removed while a hold or dispute applies and
// when an order is released, so orders that stay blocked are never rescanned and
// cannot crowd out newer overdue ones. Every release still goes through the same
// transactional checks, so running it twice or alongside a task is harmless.
export class OrderReleaseReconciliationService {
  constructor(
    private readonly orderRepository = new OrderRepository(),
    private readonly releaseService = new OrderReleaseService(
      orderRepository,
    ),
  ) {}

  async reconcile(
    now = new Date(),
    limit = DEFAULT_RECONCILE_LIMIT,
  ): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = {
      scanned: 0,
      released: 0,
      alreadyReleased: 0,
      blocked: 0,
      tasksScheduled: 0,
      errors: 0,
    };

    await this.releaseDueOrders(now, limit, summary);
    await this.scheduleMissingTasks(
      now,
      Math.max(limit - summary.scanned, 0),
      summary,
    );

    return summary;
  }

  private async releaseDueOrders(
    now: Date,
    limit: number,
    summary: ReconciliationSummary,
  ): Promise<void> {
    let cursor: { autoReleaseAt: Date; id: string } | undefined;

    while (summary.scanned < limit) {
      const page = await this.orderRepository.getOrdersByAutoRelease(
        'due',
        now,
        Math.min(PAGE_SIZE, limit - summary.scanned),
        cursor,
      );
      if (page.length === 0) {
        return;
      }

      for (const order of page) {
        summary.scanned += 1;
        try {
          const result = await this.orderRepository.releaseOrderForPayout(
            order.id,
            'hold_expired',
            now,
          );
          if (result.status === 'released') {
            summary.released += 1;
          } else if (result.status === 'already_released') {
            summary.alreadyReleased += 1;
          } else {
            summary.blocked += 1;
          }
        } catch (err) {
          summary.errors += 1;
          console.error(`Reconciliation failed to release ${order.id}:`, err);
        }
      }

      const last = page[page.length - 1];
      if (!last.autoReleaseAt) {
        return;
      }
      cursor = { autoReleaseAt: last.autoReleaseAt, id: last.id };
    }
  }

  private async scheduleMissingTasks(
    now: Date,
    limit: number,
    summary: ReconciliationSummary,
  ): Promise<void> {
    if (limit === 0) {
      return;
    }

    const upcoming = await this.orderRepository.getOrdersByAutoRelease(
      'upcoming',
      now,
      limit,
    );
    summary.scanned += upcoming.length;

    for (const order of upcoming) {
      if (order.releaseTaskEnqueuedAt || !order.releaseAt) {
        continue;
      }
      try {
        await this.releaseService.ensureReleaseTask(order.id, order.releaseAt);
        summary.tasksScheduled += 1;
      } catch (err) {
        summary.errors += 1;
        console.error(`Reconciliation failed to schedule ${order.id}:`, err);
      }
    }
  }
}
