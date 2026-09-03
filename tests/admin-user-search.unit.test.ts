import { describe, expect, test } from "bun:test";

import {
    adminMobileSearchValues,
    adminUserSearchOr,
    normalizeAdminUserSearch,
} from "../apps/api/src/lib/adminUserSearch";

describe("admin user search", () => {
    test("trims input and searches formatted numbers only as mobile", () => {
        const clauses = adminUserSearchOr("  +91 98765-43210  ");
        expect(normalizeAdminUserSearch("  Rahul  ")).toBe("Rahul");
        expect(clauses).toEqual([
            { mobileNumber: { contains: "919876543210" } },
            { mobileNumber: { contains: "9876543210" } },
        ]);
        expect(adminMobileSearchValues("+91 98765-43210")).toEqual([
            "919876543210",
            "9876543210",
        ]);
    });

    test("treats all digits as mobile and #digits as exact serial", () => {
        expect(adminUserSearchOr("12045")).toEqual([
            { mobileNumber: { contains: "12045" } },
        ]);
        expect(adminUserSearchOr("#12045")).toEqual([{ serialNumber: 12045 }]);
        expect(adminUserSearchOr("# 12045")).toEqual([{ serialNumber: 12045 }]);
        expect(adminUserSearchOr("#999999999999999999999")).toEqual([]);
        expect(adminUserSearchOr("#not-a-uid")).toEqual([]);
    });

    test("searches ordinary text by username, email, and referral fields", () => {
        const clauses = adminUserSearchOr("RahulCode");
        expect(clauses).toContainEqual({
            username: { contains: "RahulCode", mode: "insensitive" },
        });
        expect(clauses).toContainEqual({
            email: { contains: "RahulCode", mode: "insensitive" },
        });
        expect(clauses).toContainEqual({
            referralCode: { contains: "RahulCode", mode: "insensitive" },
        });
        expect(clauses).not.toContainEqual({ id: "RahulCode" });
        expect(clauses).not.toContainEqual({
            mobileNumber: { contains: "RahulCode" },
        });
    });

    test("matches a UUID only against the internal user ID", () => {
        const uuid = "123e4567-e89b-42d3-a456-426614174000";
        expect(adminUserSearchOr(uuid)).toEqual([{ id: uuid }]);
    });
});
