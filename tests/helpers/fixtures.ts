import { createHash } from "crypto";
import { prisma, type Role, type User } from "@bcwin/db";
import { generateToken } from "../../apps/api/src/lib/auth";
import { generateNextSerialNumber } from "../../apps/api/src/lib/utils";

export type CreatedUser = User & { plainPassword: string };

export function hashPassword(password: string): string {
    return createHash("md5").update(password).digest("hex");
}

export function makeRunId(label = "t"): string {
    return `dt_${label}_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
}

export class FixtureTracker {
    readonly runId: string;
    readonly userIds: string[] = [];
    readonly periodPrefix: string;
    readonly giftPrefix: string;
    readonly orderPrefix: string;

    constructor(label = "suite") {
        this.runId = makeRunId(label);
        this.periodPrefix = `DT_${this.runId}_`;
        this.giftPrefix = `DTGIFT_${this.runId}_`;
        this.orderPrefix = `DT-${this.runId}-`;
    }

    trackUser(id: string) {
        this.userIds.push(id);
        return id;
    }
}

let mobileSeq = 0;

export async function createTestUser(
    tracker: FixtureTracker,
    opts: {
        role?: Role;
        balance?: number;
        referredBy?: string | null;
        username?: string;
        password?: string;
        isBanned?: boolean;
    } = {}
): Promise<CreatedUser> {
    const n = ++mobileSeq;
    const serialNumber = await generateNextSerialNumber();
    const password = opts.password ?? "Password123!";
    const username =
        opts.username ??
        `${tracker.runId}_u${n}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 28);
    // E.164 unique mobile
    const mobileNumber = `91${String(9000000000 + Math.floor(Math.random() * 99999999) + n * 137).slice(0, 10)}`;

    const referralCode = `RC${serialNumber}${n}`.slice(0, 16);

    const user = await prisma.user.create({
        data: {
            serialNumber,
            username,
            mobileNumber,
            password: hashPassword(password),
            referralCode,
            referredBy: opts.referredBy ?? null,
            balance: opts.balance ?? 10_000,
            role: opts.role ?? "USER",
            isBanned: opts.isBanned ?? false,
        },
    });

    tracker.trackUser(user.id);
    return Object.assign(user, { plainPassword: password });
}

export async function authCookieFor(user: User): Promise<string> {
    return generateToken(user);
}

export async function ensureSystemConfig() {
    const existing = await prisma.config.findFirst();
    if (existing) {
        if (existing.maintananceMode) {
            await prisma.config.update({
                where: { id: existing.id },
                data: { maintananceMode: false },
            });
        }
        return existing;
    }
    return prisma.config.create({
        data: {
            upiIds: [],
            maintananceMode: false,
            serviceFeePercent: 2,
            minDepositAmount: 100,
            minWithdrawAmount: 300,
        },
    });
}

export async function createActiveWingoPeriod(
    tracker: FixtureTracker,
    durationSeconds = 60
) {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
    const periodNumber = `${tracker.periodPrefix}${durationSeconds}_${Date.now()}`;

    return prisma.wingoPeriod.create({
        data: {
            periodNumber,
            durationSeconds,
            startTime,
            endTime,
            status: "ACTIVE",
        },
    });
}

export async function createActiveK3Period(
    tracker: FixtureTracker,
    durationSeconds = 60
) {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
    const periodNumber = `${tracker.periodPrefix}K3_${durationSeconds}_${Date.now()}`;

    return prisma.k3Period.create({
        data: {
            periodNumber,
            durationSeconds,
            startTime,
            endTime,
            status: "ACTIVE",
        },
    });
}

export async function createActiveFiveDPeriod(
    tracker: FixtureTracker,
    durationSeconds = 60
) {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
    const periodNumber = `${tracker.periodPrefix}5D_${durationSeconds}_${Date.now()}`;

    return prisma.fiveDPeriod.create({
        data: {
            periodNumber,
            durationSeconds,
            startTime,
            endTime,
            status: "ACTIVE",
        },
    });
}

export async function createActiveMotoPeriod(
    tracker: FixtureTracker,
    durationSeconds = 60
) {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
    const periodNumber = `${tracker.periodPrefix}MOTO_${durationSeconds}_${Date.now()}`;

    return prisma.motoPeriod.create({
        data: {
            periodNumber,
            durationSeconds,
            startTime,
            endTime,
            status: "ACTIVE",
        },
    });
}

export async function createActiveTrxWingoPeriod(
    tracker: FixtureTracker,
    durationSeconds = 60
) {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
    const periodNumber = `${tracker.periodPrefix}TRX_${durationSeconds}_${Date.now()}`;

    return prisma.trxWingoPeriod.create({
        data: {
            periodNumber,
            durationSeconds,
            startTime,
            endTime,
            status: "ACTIVE",
        },
    });
}

export async function seedOtp(mobileOrEmail: string, otp = "123456") {
    // Otp is unique on mobileNumber and email separately
    const isEmail = mobileOrEmail.includes("@");
    if (isEmail) {
        await prisma.otp.upsert({
            where: { email: mobileOrEmail },
            create: { email: mobileOrEmail, otp },
            update: { otp },
        });
    } else {
        await prisma.otp.upsert({
            where: { mobileNumber: mobileOrEmail },
            create: { mobileNumber: mobileOrEmail, otp },
            update: { otp },
        });
    }
    return otp;
}
