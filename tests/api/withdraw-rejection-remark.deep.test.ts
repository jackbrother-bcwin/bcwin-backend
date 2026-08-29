import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@bcwin/db";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    ensureSystemConfig,
    get,
    post,
} from "../helpers";

describe("Admin withdrawal rejection remark", () => {
    const tracker = new FixtureTracker("withdraw_reject_remark");
    let adminCookie: string;
    let userCookie: string;
    let userId: string;
    let orderId: string;

    beforeAll(async () => {
        await ensureSystemConfig();
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        const user = await createTestUser(tracker, { balance: 700 });
        adminCookie = await authCookieFor(admin);
        userCookie = await authCookieFor(user);
        userId = user.id;
        orderId = `${tracker.orderPrefix}REMARK`;

        await prisma.withdraw.create({
            data: {
                userId,
                orderId,
                amount: 300,
                method: "UPI",
                status: "GENERATED",
            },
        });
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("reject stores the trimmed remark, refunds, and returns it in user history", async () => {
        const res = await post(
            "/api/v1/admin/transactions/withdraw/manage",
            {
                cookie: adminCookie,
                json: {
                    action: "reject",
                    orderId,
                    remark: "  Account holder name does not match  ",
                },
            }
        );

        expect(res.status).toBe(200);

        const [withdrawal, user] = await Promise.all([
            prisma.withdraw.findUniqueOrThrow({ where: { orderId } }),
            prisma.user.findUniqueOrThrow({ where: { id: userId } }),
        ]);
        expect(withdrawal.status).toBe("FAILED");
        expect(withdrawal.note).toBe("Account holder name does not match");
        expect(user.balance).toBe(1000);

        const history = await get("/api/v1/user/withdrawals", {
            cookie: userCookie,
            query: { status: "FAILED", page: 1, limit: 20 },
        });
        expect(history.status).toBe(200);
        const row = history.json?.withdrawals?.find(
            (item: { orderId?: string }) => item.orderId === orderId
        );
        expect(row?.note).toBe("Account holder name does not match");
    });

    test("remark is capped at 300 characters", async () => {
        const longOrderId = `${tracker.orderPrefix}TOO-LONG`;
        await prisma.withdraw.create({
            data: {
                userId,
                orderId: longOrderId,
                amount: 100,
                method: "UPI",
                status: "GENERATED",
            },
        });

        const res = await post(
            "/api/v1/admin/transactions/withdraw/manage",
            {
                cookie: adminCookie,
                json: {
                    action: "reject",
                    orderId: longOrderId,
                    remark: "x".repeat(301),
                },
            }
        );
        expect(res.status).toBe(400);
        expect(
            await prisma.withdraw.findUniqueOrThrow({
                where: { orderId: longOrderId },
            })
        ).toMatchObject({ status: "GENERATED", note: null });
    });
});
