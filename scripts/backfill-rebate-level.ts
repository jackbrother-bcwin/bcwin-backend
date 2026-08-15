/**
 * One-shot after migration 20260811120000:
 * 1) Recompute TeamMetrics + sticky rebateLevel for all UserVipLevel rows
 * 2) Recompute unsettled Rebate.receiverVip / rate / amount from rebateLevel
 *
 *   cd backend && bun --env-file .env run scripts/backfill-rebate-level.ts
 */
import { VipLevelService } from "../apps/engine/src/services/vip/vipLevelService";

async function main() {
    console.log("Backfill rebateLevel from team metrics…");
    const raised = await VipLevelService.backfillRebateLevels();
    console.log(`  raised rebateLevel on ${raised} users`);

    console.log("Recompute unsettled rebates (receiverVip/rate/amount)…");
    const n = await VipLevelService.recomputeUnsettledRebateReceiverLevels();
    console.log(`  updated ${n} unsettled rebate rows`);

    console.log("Done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
