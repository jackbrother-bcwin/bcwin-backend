import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { authCookie } from "@/schemas";
import { prisma } from "@bcwin/db";
import { getTeamMembers } from "./helpers";

const logger = new Logger("admin-invite-tree");

// ===================== Schemas =====================

const inviteTreeMemberSchema = z.object({
    id: z.string().openapi({ description: "User ID", example: "uuid-123" }),
    serialNumber: z.number().openapi({ description: "Serial number", example: 10001 }),
    username: z.string().openapi({ description: "Username", example: "alice" }),
    mobileNumber: z.string().openapi({ description: "Mobile number", example: "9876543210" }),
    layer: z.number().openapi({ description: "Depth level (1 = direct invite)", example: 1 }),
    referralCode: z.string().openapi({ description: "Referral code of this member", example: "ALICE123" }),
    referredBy: z.string().nullable().openapi({ description: "Referral code used to join", example: "ROOT001" }),
    createdAt: z.string().openapi({ description: "Account creation timestamp", example: "2025-01-01T00:00:00Z" }),
});

const inviteTreeResponseSchema = z.object({
    success: z.boolean(),
    user: z.object({
        id: z.string(),
        serialNumber: z.number(),
        username: z.string(),
        mobileNumber: z.string(),
        referralCode: z.string(),
    }),
    tree: z.array(inviteTreeMemberSchema),
    total: z.number().openapi({ description: "Total invited members across all layers" }),
    layerCounts: z.record(z.string(), z.number()).openapi({
        description: "Number of members per layer, e.g. { '1': 5, '2': 12 }",
    }),
});

// ===================== Route definition =====================

const getInviteTreeRoute = createRoute({
    method: "get",
    path: "/invite-tree",
    tags: ["admin"],
    summary: "Get user invite tree",
    description:
        "Retrieve the full downline / invite tree for a user. " +
        "Identify the user by one of: `userId` (UUID), `serialNumber`, `mobile`, `username`, or free-text `search`. " +
        "Returns up to 6 layers of invited members.",
    request: {
        query: z.object({
            userId: z.string().optional().openapi({
                description: "User UUID",
                example: "uuid-123",
            }),
            serialNumber: z
                .string()
                .optional()
                .openapi({
                    description: "User serial number (numeric string)",
                    example: "10009",
                }),
            mobile: z.string().optional().openapi({
                description: "User mobile number",
                example: "9876543210",
            }),
            username: z.string().optional().openapi({
                description: "Exact username",
                example: "user_9855641885",
            }),
            search: z.string().optional().openapi({
                description:
                    "Smart lookup: UUID, serial, mobile, username, or referral code",
                example: "8400",
            }),
            layer: z
                .string()
                .optional()
                .openapi({
                    description: "Filter to a specific layer (1–6). Omit for all layers.",
                    example: "1",
                }),
        }),
        cookies: authCookie,
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: inviteTreeResponseSchema,
                },
            },
            description: "Invite tree retrieved successfully",
        },
        ...CommonResponses.badRequest(),
        ...CommonResponses.unauthorized(),
        ...CommonResponses.internalServerError(),
    },
});

// ===================== Route handler =====================

export const inviteTreeRoutes = (app: OpenAPIHono) => {
    app.openapi(getInviteTreeRoute, async (c) => {
        try {
            const { userId, serialNumber, mobile, username, search, layer } =
                c.req.valid("query");

            // At least one identifier must be provided
            if (!userId && !serialNumber && !mobile && !username && !search) {
                return apiError(
                    c,
                    "Provide at least one of: userId, serialNumber, mobile, username, or search",
                    HTTP_STATUS.BAD_REQUEST
                );
            }

            // Resolve the root user
            const rootUserSelect = {
                id: true,
                serialNumber: true,
                username: true,
                mobileNumber: true,
                referralCode: true,
            } as const;

            type RootUser = {
                id: string;
                serialNumber: number;
                username: string;
                mobileNumber: string;
                referralCode: string;
            };

            let rootUser: RootUser | null = null;

            const resolveSearch = async (raw: string): Promise<RootUser | null> => {
                const q = raw.trim();
                if (!q) return null;

                // UUID
                if (
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                        q
                    )
                ) {
                    return prisma.user.findUnique({
                        where: { id: q },
                        select: rootUserSelect,
                    });
                }

                // 10-digit mobile
                if (/^\d{10}$/.test(q)) {
                    return prisma.user.findFirst({
                        where: { mobileNumber: q },
                        select: rootUserSelect,
                    });
                }

                // Serial number (must fit PostgreSQL Int: -2,147,483,648 … 2,147,483,647)
                if (/^\d+$/.test(q)) {
                    const sn = parseInt(q, 10);
                    if (!isNaN(sn) && sn >= -2147483648 && sn <= 2147483647) {
                        const bySerial = await prisma.user.findUnique({
                            where: { serialNumber: sn },
                            select: rootUserSelect,
                        });
                        if (bySerial) return bySerial;
                    }
                    // Out-of-range number — skip serial lookup, fall through to username/code
                }

                // Username (exact, case-insensitive)
                const byUsername = await prisma.user.findFirst({
                    where: {
                        username: { equals: q, mode: "insensitive" },
                    },
                    select: rootUserSelect,
                });
                if (byUsername) return byUsername;

                // Referral code (exact)
                const byCode = await prisma.user.findFirst({
                    where: { referralCode: q },
                    select: rootUserSelect,
                });
                if (byCode) return byCode;

                return null;
            };

            if (userId) {
                rootUser = await prisma.user.findUnique({
                    where: { id: userId },
                    select: rootUserSelect,
                });
            } else if (serialNumber) {
                const sn = parseInt(serialNumber, 10);
                if (isNaN(sn) || sn < -2147483648 || sn > 2147483647) {
                    return apiError(
                        c,
                        "serialNumber must be a valid integer within range",
                        HTTP_STATUS.BAD_REQUEST
                    );
                }
                rootUser = await prisma.user.findUnique({
                    where: { serialNumber: sn },
                    select: rootUserSelect,
                });
            } else if (mobile) {
                rootUser = await prisma.user.findFirst({
                    where: { mobileNumber: mobile },
                    select: rootUserSelect,
                });
            } else if (username) {
                rootUser = await prisma.user.findFirst({
                    where: {
                        username: { equals: username, mode: "insensitive" },
                    },
                    select: rootUserSelect,
                });
            } else if (search) {
                rootUser = await resolveSearch(search);
            }

            if (!rootUser) {
                return apiError(c, "User not found", HTTP_STATUS.BAD_REQUEST);
            }

            // Fetch full invite tree (up to 6 layers)
            const allMembers = await getTeamMembers(rootUser.id);

            // Filter by layer if provided
            let filtered = allMembers;
            if (layer) {
                const layerNum = parseInt(layer);
                if (isNaN(layerNum) || layerNum < 1 || layerNum > 6) {
                    return apiError(c, "layer must be an integer between 1 and 6", HTTP_STATUS.BAD_REQUEST);
                }
                filtered = allMembers.filter((m) => m.layer === layerNum);
            }

            // Enrich members with extra fields (serialNumber, mobileNumber, referredBy)
            const memberIds = filtered.map((m) => m.user.id);
            const memberDetails = await prisma.user.findMany({
                where: { id: { in: memberIds } },
                select: {
                    id: true,
                    serialNumber: true,
                    mobileNumber: true,
                    referredBy: true,
                },
            });
            const detailsMap = new Map(memberDetails.map((u) => [u.id, u]));

            const tree = filtered.map(({ user: member, layer: l }) => {
                const details = detailsMap.get(member.id);
                return {
                    id: member.id,
                    serialNumber: details?.serialNumber ?? 0,
                    username: member.username,
                    mobileNumber: details?.mobileNumber ?? "",
                    layer: l,
                    referralCode: member.referralCode,
                    referredBy: details?.referredBy ?? null,
                    createdAt: member.createdAt instanceof Date
                        ? member.createdAt.toISOString()
                        : member.createdAt,
                };
            });

            // Build per-layer counts from full tree (not filtered)
            const layerCounts: Record<string, number> = {};
            for (const { layer: l } of allMembers) {
                const key = String(l);
                layerCounts[key] = (layerCounts[key] ?? 0) + 1;
            }

            return c.json(
                {
                    success: true,
                    user: {
                        id: rootUser.id,
                        serialNumber: rootUser.serialNumber,
                        username: rootUser.username,
                        mobileNumber: rootUser.mobileNumber,
                        referralCode: rootUser.referralCode,
                    },
                    tree,
                    total: allMembers.length,
                    layerCounts,
                },
                HTTP_STATUS.OK
            );
        } catch (error) {
            logger.error("Error fetching invite tree:", error);
            return apiError(c, "Internal server error", HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }
    });
};
