import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { prisma, type User } from "@bcwin/db";
import { SystemSettings } from "@bcwin/config";
import { WebSocketManager } from "@bcwin/websocket";
import { calculateExpirationDate } from "@bcwin/activity-bonus/expiration";
import { expireOldBonuses } from "@bcwin/activity-bonus";
import { activityClaimRoutes } from "../../apps/api/src/routes/user/activity/claim";

const restores: Array<() => void> = [];
function mockDb(target: any, method: string) {
    const original = target[method];
    const replacement = mock();
    target[method] = replacement;
    restores.push(() => { target[method] = original; });
    return replacement;
}
afterEach(() => {
    for (const restore of restores.reverse()) restore();
    restores.length = 0;
    mock.restore();
});

describe("Activity bonus expiry", () => {
    for (const type of ["DAILY", "INVITATION", "FIRST_DEPOSIT"]) {
        test(`${type} has no deadline and a legacy overdue reward can be claimed`, async () => {
            expect(calculateExpirationDate(type)).toBeNull();
            const bonus = {
                id: "bonus-id", userId: "user-id", type,
                status: "COMPLETED_UNCOLLECTED", amount: 28,
                expiresAt: new Date("2020-01-01"),
                createdAt: new Date("2019-12-01"), updatedAt: new Date(),
            };
            mockDb(prisma.activityBonus, "findUnique").mockResolvedValue(bonus as any);
            spyOn(SystemSettings, "get").mockResolvedValue({ rewardWagerFactor: 2 } as any);
            spyOn(WebSocketManager, "publishToUser").mockImplementation(async () => {});
            const tx = {
                user: { update: mock(async (_args: any) => ({ balance: 128 })) },
                activityBonus: {
                    updateMany: mock(async (_args: any) => ({ count: 1 })),
                    findUniqueOrThrow: mock(async () => ({ ...bonus, status: "COLLECTED", expiresAt: null, claimAt: new Date() })),
                },
                wagerRequirement: { create: mock(async ({ data }: any) => data) },
            };
            mockDb(prisma, "$transaction").mockImplementation((async (fn: any) => fn(tx)) as any);

            const app = new OpenAPIHono();
            app.use("*", async (c, next) => { c.set("user", { id: "user-id" } as User); await next(); });
            activityClaimRoutes(app);
            const response = await app.request("/claim", {
                method: "POST", headers: { "content-type": "application/json", cookie: "auth-token=test" },
                body: JSON.stringify({ bonusId: bonus.id }),
            });
            expect(response.status).toBe(200);
            expect((await response.json()).data.bonus.status).toBe("COLLECTED");
            expect(tx.user.update.mock.calls[0][0].data.balance.increment).toBe(28);
            expect(tx.activityBonus.updateMany.mock.calls[0][0].data.expiresAt).toBeNull();
            expect(tx.wagerRequirement.create.mock.calls[0][0].data.requiredWager).toBe(56);
        });
    }

    for (const [type, days] of [["WEEKLY", 7], ["ATTENDENCE", 1]] as const) {
        test(`${type} keeps its deadline and rejects overdue claims`, async () => {
            const start = Date.now();
            expect(calculateExpirationDate(type)!.getTime()).toBeGreaterThanOrEqual(start + days * 86400000);
            mockDb(prisma.activityBonus, "findUnique").mockResolvedValue({
                id: "bonus-id", userId: "user-id", type,
                status: "COMPLETED_UNCOLLECTED", expiresAt: new Date("2020-01-01"),
            } as any);
            const update = mockDb(prisma.activityBonus, "updateMany").mockResolvedValue({ count: 1 });
            const transaction = mockDb(prisma, "$transaction");
            const app = new OpenAPIHono();
            app.use("*", async (c, next) => { c.set("user", { id: "user-id" } as User); await next(); });
            activityClaimRoutes(app);
            const response = await app.request("/claim", {
                method: "POST", headers: { "content-type": "application/json", cookie: "auth-token=test" },
                body: JSON.stringify({ bonusId: "bonus-id" }),
            });
            expect(response.status).toBe(400);
            expect((await response.json()).error).toBe("Bonus has expired");
            expect(update).toHaveBeenCalledWith({ where: { id: "bonus-id", status: "COMPLETED_UNCOLLECTED" }, data: { status: "EXPIRED" } });
            expect(transaction).not.toHaveBeenCalled();
        });
    }

    test("hourly expiry excludes all three non-expiring types even with legacy deadlines", async () => {
        const update = mockDb(prisma.activityBonus, "updateMany").mockResolvedValue({ count: 0 });
        await expireOldBonuses();
        const query = update.mock.calls[0][0]!;
        expect(query.where?.type).toEqual({ notIn: ["DAILY", "INVITATION", "FIRST_DEPOSIT"] });
        expect(query.where?.status).toBe("COMPLETED_UNCOLLECTED");
        expect(query.where?.expiresAt).toEqual({ lt: expect.any(Date) });
    });
});
