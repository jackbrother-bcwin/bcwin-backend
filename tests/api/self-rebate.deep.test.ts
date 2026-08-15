import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@bcwin/db";
import {
  get,
  post,
  FixtureTracker,
  createTestUser,
  authCookieFor,
  cleanupByUserIds,
  ensureSystemConfig,
} from "../helpers";
import { SelfRebateCalculator } from "../../packages/rebate/selfRebateCalculator";

describe("Deep: Self-Rebate API and Accrual lifecycle", () => {
  const tracker = new FixtureTracker("selfreb");
  let userCookie: string;
  let userId: string;

  beforeAll(async () => {
    await ensureSystemConfig();
    const testUser = await createTestUser(tracker, { balance: 5000 });
    userId = testUser.id;
    // VIP3 = 0.1% self-rebate (ADR-0021)
    await prisma.userVipLevel.upsert({
      where: { userId },
      create: {
        userId,
        currentLevel: 3,
        rebateLevel: 0,
        teamSize: 0,
        teamBetting: 0,
        teamDeposit: 0,
      },
      update: { currentLevel: 3 },
    });
    userCookie = await authCookieFor(testUser);
  });

  afterAll(async () => {
    // Delete all user data & fixtures created during this test
    await cleanupByUserIds(tracker.userIds, {
      periodPrefix: tracker.periodPrefix,
    });
  });

  test("Accrue self-rebate calculates 0.1% correctly", async () => {
    // Bet 1000 on WINGO -> 0.1% = 1.0
    await SelfRebateCalculator.accrueForBet({
      userId,
      betAmount: 1000,
      game: "WINGO",
    });

    // Bet 500 on K3 -> 0.1% = 0.5
    await SelfRebateCalculator.accrueForBet({
      userId,
      betAmount: 500,
      game: "K3",
    });

    const rows = await prisma.selfRebate.findMany({
      where: { userId, claimed: false },
    });

    expect(rows.length).toBe(2);
    const wingoRow = rows.find((r) => r.game === "WINGO");
    const k3Row = rows.find((r) => r.game === "K3");

    expect(wingoRow).toBeDefined();
    expect(wingoRow?.amount).toBeCloseTo(1.0, 4);
    expect(wingoRow?.rate).toBe(0.1);

    expect(k3Row).toBeDefined();
    expect(k3Row?.amount).toBeCloseTo(0.5, 4);
    expect(k3Row?.rate).toBe(0.1);
  });

  test("GET /user/rebate/self/summary returns correct unclaimed today totals", async () => {
    const res = await get("/api/v1/user/rebate/self/summary", {
      cookie: userCookie,
    });

    expect(res.status).toBe(200);
    expect(res.json?.success).toBe(true);
    expect(res.json?.data?.todayRebate).toBeCloseTo(1.5, 4);
    expect(res.json?.data?.rate).toBe(0.1);
    expect(Array.isArray(res.json?.data?.categories)).toBe(true);

    const lotteryCat = res.json?.data?.categories?.find(
      (c: any) => c.category === "LOTTERY"
    );
    expect(lotteryCat).toBeDefined();
    expect(lotteryCat?.betAmount).toBe(1500);
    expect(lotteryCat?.rebateAmount).toBeCloseTo(1.5, 4);
  });

  test("POST /user/rebate/self/claim claims today's rebate atomically", async () => {
    const initialUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    const initialBalance = initialUser?.balance ?? 5000;

    const res = await post("/api/v1/user/rebate/self/claim", {
      cookie: userCookie,
      json: {},
    });

    expect(res.status).toBe(200);
    expect(res.json?.success).toBe(true);
    expect(res.json?.data?.claimedAmount).toBeCloseTo(1.5, 4);
    expect(res.json?.data?.claimedCount).toBe(2);
    expect(res.json?.data?.newBalance).toBeCloseTo(initialBalance + 1.5, 4);

    // Verify database state
    const claimedRows = await prisma.selfRebate.findMany({
      where: { userId, claimed: true },
    });
    expect(claimedRows.length).toBe(2);

    // Second claim should return 0 claimed (idempotent)
    const secondClaim = await post("/api/v1/user/rebate/self/claim", {
      cookie: userCookie,
      json: {},
    });
    expect(secondClaim.status).toBe(200);
    expect(secondClaim.json?.data?.claimedAmount).toBe(0);
    expect(secondClaim.json?.data?.claimedCount).toBe(0);
  });

  test("GET /user/rebate/self/history returns completed rebate history", async () => {
    const res = await get("/api/v1/user/rebate/self/history", {
      cookie: userCookie,
      query: { category: "LOTTERY", page: 1, limit: 20 },
    });

    expect(res.status).toBe(200);
    expect(res.json?.success).toBe(true);
    expect(Array.isArray(res.json?.data)).toBe(true);
    expect(res.json?.data?.length).toBeGreaterThan(0);

    const item = res.json.data[0];
    expect(item.category).toBe("LOTTERY");
    expect(item.status).toBe("Completed");
    expect(item.betAmount).toBe(1500);
    expect(item.rebateAmount).toBeCloseTo(1.5, 4);
  });

  test("Expired rebate logic for past day unclaimed rebates", async () => {
    // Manually create an unclaimed self-rebate row for a past date
    const pastDate = "2020-01-01";
    await prisma.selfRebate.create({
      data: {
        userId,
        betAmount: 2000,
        rate: 0.1,
        amount: 2.0,
        game: "SLOTS",
        gameCategory: "SLOTS",
        date: pastDate,
        claimed: false,
        expired: false,
      },
    });

    // Run expiry task
    await SelfRebateCalculator.expireUnclaimed();

    // Verify row status
    const expiredRow = await prisma.selfRebate.findFirst({
      where: { userId, date: pastDate },
    });
    expect(expiredRow?.expired).toBe(true);
    expect(expiredRow?.claimed).toBe(false);

    // Check history endpoint returns "Expired" status
    const res = await get("/api/v1/user/rebate/self/history", {
      cookie: userCookie,
      query: { category: "SLOTS" },
    });

    expect(res.status).toBe(200);
    const slotsItem = res.json?.data?.find((d: any) => d.date === pastDate);
    expect(slotsItem).toBeDefined();
    expect(slotsItem?.status).toBe("Expired");
  });
});
