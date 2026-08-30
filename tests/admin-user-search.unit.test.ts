import { describe, expect, test } from "bun:test";

import {
    adminMobileSearchValues,
    adminUserSearchOr,
    normalizeAdminUserSearch,
} from "../apps/api/src/lib/adminUserSearch";

describe("admin user search", () => {
    test("trims text and matches normalized mobile digits", () => {
        const clauses = adminUserSearchOr("  +91 98765-43210  ");
        expect(normalizeAdminUserSearch("  Rahul  ")).toBe("Rahul");
        expect(clauses).toContainEqual({
            mobileNumber: { contains: "919876543210" },
        });
        expect(clauses).toContainEqual({
            mobileNumber: { contains: "9876543210" },
        });
        expect(adminMobileSearchValues("+91 98765-43210")).toEqual([
            "919876543210",
            "9876543210",
        ]);
        expect(clauses).toContainEqual({
            username: { contains: "+91 98765-43210", mode: "insensitive" },
        });
    });

    test("adds an exact serial clause only for a safe all-digit value", () => {
        expect(adminUserSearchOr("12045")).toContainEqual({
            serialNumber: 12045,
        });
        expect(adminUserSearchOr("999999999999999999999")).not.toContainEqual(
            { serialNumber: 999999999999999999999 }
        );
    });

    test("includes username, email, referral, and UUID clauses", () => {
        const clauses = adminUserSearchOr("RahulCode");
        expect(clauses).toContainEqual({
            email: { contains: "RahulCode", mode: "insensitive" },
        });
        expect(clauses).toContainEqual({
            referralCode: { contains: "RahulCode", mode: "insensitive" },
        });
        expect(clauses).toContainEqual({ id: "RahulCode" });
    });
});
