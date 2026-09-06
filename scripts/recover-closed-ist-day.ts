/**
 * Pay a missed IST Agent-commission close without wiping today's rebateLevel.
 *
 *   bun --env-file .env scripts/recover-closed-ist-day.ts 2026-09-05
 */
import { DailyTeamRebate } from "@bcwin/rebate";

const ymd = process.argv[2];
if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    console.error("Usage: bun scripts/recover-closed-ist-day.ts YYYY-MM-DD");
    process.exit(1);
}

async function main() {
    const needed = await DailyTeamRebate.needsClose(ymd);
    console.log(`IST day ${ymd} needsClose=${needed}`);
    if (!needed) {
        console.log("Already closed or no bets that day. Nothing to do.");
        return;
    }
    const result = await DailyTeamRebate.processClosedIstDay(ymd, {
        resetRebateLevel: false,
    });
    console.log(
        `Closed ${ymd}: created=${result.created} settled=${result.settled}`
    );
}

await main();
