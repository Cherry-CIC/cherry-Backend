/**
 * Backfill payout holds for orders delivered before the hold existed.
 *
 * Dry run by default: nothing is written without --apply. Safe to repeat.
 *
 * Usage:
 *   npm run payout:backfill                     # dry run, prints what would change
 *   npm run payout:backfill -- --apply          # write the holds
 *   npm run payout:backfill -- --limit 500      # scan at most 500 paid orders
 *
 * Run it after deploying and before the payout step (#44) is switched on. The
 * next scheduled release run then releases the orders whose hold has passed.
 */

import { PayoutBackfillService } from '../modules/order/services/PayoutBackfillService';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;

if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit must be a positive integer');
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(apply ? 'Applying payout hold backfill...' : 'Dry run (use --apply to write)...');

  const summary = await new PayoutBackfillService().run({
    apply,
    limit,
    onPlan: (orderId, plan) => {
      if (plan.action === 'hold') {
        console.log(
          `${apply ? 'hold' : 'would hold'} ${orderId}: delivered ${plan.deliveredAt.toISOString()} (${plan.deliveredAtSource}), release ${plan.releaseAt.toISOString()}${plan.holdReason ? `, hold reason ${plan.holdReason}` : ''}`,
        );
      }
    },
  });

  console.log('\nSummary:', JSON.stringify(summary, null, 2));
  process.exit(summary.errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
