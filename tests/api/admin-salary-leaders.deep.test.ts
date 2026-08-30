import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { prisma } from "@bcwin/db";
import {
    FixtureTracker,
    authCookieFor,
    cleanupByUserIds,
    createTestUser,
    del,
    ensureSystemConfig,
    get,
    post,
} from "../helpers";

describe("Admin Salary Leaders", () => {
    const tracker = new FixtureTracker("salary_leaders");
    let adminCookie: string;
    let leader: Awaited<ReturnType<typeof createTestUser>>;
    let otherUser: Awaited<ReturnType<typeof createTestUser>>;

    beforeAll(async () => {
        await ensureSystemConfig();
        const admin = await createTestUser(tracker, { role: "ADMIN" });
        leader = await createTestUser(tracker, {
            username: `leader_${tracker.runId}`.slice(0, 28),
        });
        otherUser = await createTestUser(tracker, {
            username: `other_${tracker.runId}`.slice(0, 28),
        });
        adminCookie = await authCookieFor(admin);
    });

    afterAll(async () => {
        await cleanupByUserIds(tracker.userIds, {
            periodPrefix: tracker.periodPrefix,
            giftCodePrefix: tracker.giftPrefix,
            orderIdPrefix: tracker.orderPrefix,
        });
    });

    test("admin can add a user once and search the curated list", async () => {
        const created = await post("/api/v1/admin/salary-leaders", {
            cookie: adminCookie,
            json: { userId: leader.id },
        });
        expect(created.status).toBe(201);
        expect(created.json?.leader?.userId).toBe(leader.id);

        const duplicate = await post("/api/v1/admin/salary-leaders", {
            cookie: adminCookie,
            json: { userId: leader.id },
        });
        expect(duplicate.status).toBe(400);

        const list = await get("/api/v1/admin/salary-leaders", {
            cookie: adminCookie,
            query: { search: leader.mobileNumber, page: 1, limit: 20 },
        });
        expect(list.status).toBe(200);
        expect(list.json?.leaders).toHaveLength(1);
        expect(list.json?.leaders?.[0]?.user?.username).toBe(leader.username);

        const noMatch = await get("/api/v1/admin/salary-leaders", {
            cookie: adminCookie,
            query: { search: otherUser.username, page: 1, limit: 20 },
        });
        expect(noMatch.status).toBe(200);
        expect(noMatch.json?.leaders).toHaveLength(0);
    });

    test("delete removes only list membership, not the user account", async () => {
        const removed = await del(`/api/v1/admin/salary-leaders/${leader.id}`, {
            cookie: adminCookie,
        });
        expect(removed.status).toBe(200);

        const [membership, existingUser] = await Promise.all([
            prisma.salaryLeader.findUnique({ where: { userId: leader.id } }),
            prisma.user.findUnique({ where: { id: leader.id } }),
        ]);
        expect(membership).toBeNull();
        expect(existingUser?.id).toBe(leader.id);

        const missing = await del(`/api/v1/admin/salary-leaders/${leader.id}`, {
            cookie: adminCookie,
        });
        expect(missing.status).toBe(404);
    });
});
