import { FulfillmentTaskQueue } from './FulfillmentTaskQueue';

// Best-effort retry for an order whose direct fulfilment did not finish. The
// fulfilment job is leased per order, so a task running alongside another
// attempt is safe.
export const scheduleFulfillmentRecovery = async (
  orderId: string,
  queue = new FulfillmentTaskQueue(),
): Promise<boolean> => {
  try {
    await queue.enqueue(orderId);
    return true;
  } catch (err) {
    console.warn(
      `Could not schedule fulfilment recovery for order ${orderId}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
};
