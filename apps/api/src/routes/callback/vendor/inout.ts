import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";

import Logger from "@bcwin/logger";
import { HTTP_STATUS } from "@/lib/http";
import { apiError, CommonResponses } from "@/lib/utils";
import { prisma } from "@bcwin/db";
import { WebSocketManager } from "@bcwin/websocket";
import { Cache, CacheKey } from "@bcwin/cache";
import Inout, { ErrorCodes } from "@/lib/vendor/inout";
import { SelfRebateCalculator } from "@bcwin/rebate";
import {
    checkAndCreateWeeklyBonuses,
    checkAndCreateDailyBonuses,
} from "@bcwin/activity-bonus";

const logger = new Logger("callback-vendor-inout");

const BaseInputSchema = z.object({
    action: z.enum(["init", "bet", "withdraw", "rollback"]),
    token: z.string(),
    data: z.object().loose()
}).loose();

export const SessionInitSchema = BaseInputSchema.extend({
    action: z.literal("init"),
    data: z.object({
        currency: z.string(),
        operator: z.string(),
        gameMode: z.string(),
    }),
});

export const BetSchema = BaseInputSchema.extend({
    action: z.literal("bet"),
    gameMode: z.string(),
    data: z.object({
        amount: z.string(),
        currency: z.string(),
        operator: z.string(),
        user_id: z.string(),
        transactionId: z.string(),
        gameId: z.string()
    }),
});

export const ResultSchema = BaseInputSchema.extend({
    action: z.literal("withdraw"),
    gameMode: z.string(),
    data: z.object({
        user_id: z.string(),
        currency: z.string(),
        operator: z.string(),
        amount: z.string(),
        result: z.string(),
        coefficient: z.string(),
        transactionId: z.string(),
        debitId: z.string(),
        gameId: z.string(),
        isFinished: z.boolean()
    }),
});

export const RollbackSchema = BaseInputSchema.extend({
    action: z.literal("rollback"),
    gameMode: z.string(),
    data: z.object({
        user_id: z.string(),
        currency: z.string(),
        operator: z.string(),
        amount: z.string(),
        transactionId: z.string(),
        debitId: z.string(),
        gameId: z.string(),
        isFinished: z.boolean()
    }),
});

const inoutCallbackRoute = createRoute({
    method: "post",
    path: "/inout",
    tags: ["callback"],
    summary: "Inout callback",
    description: "Inout callback. Used for callback data from inout.",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: BaseInputSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        code: z.enum(ErrorCodes),
                        message: z.string().optional(),
                    }).loose()
                }
            },
            description: "Inout callback",
        },
        ...CommonResponses.internalServerError(),
    },
});

export const inoutCallbackRoutes = (app: OpenAPIHono) => {
    app.use("/inout", async (c, next) => {
        const rawBody = await c.req.raw.clone().text();
        (c as any).set("rawBody", rawBody);
        await next();
    });

    app.openapi(inoutCallbackRoute, async (c) => {
        try {
            const sign = c.req.header("X-REQUEST-SIGN")
            const rawBody = ((c as any).get("rawBody") as string)
            const payload = c.req.valid("json")

            logger.debug("INOUT_CALLBACK_RAW_BODY", rawBody);
            logger.debug("INOUT_CALLBACK_SIGNATURE", sign);
            logger.debug("INOUT_CALLBACK_TIMESTAMP", c.req.header("timestamp"));

            if (!sign || !await Inout.isRequestValid(rawBody, sign)) {
                return c.json({ code: ErrorCodes.CHECKS_FAIL, message: "Invalid signature" }, HTTP_STATUS.OK);
            }

            logger.debug("INOUT_CALLBACK", payload);

            if (payload.action === "init") {
                return c.json(await handleSessionInit(payload), HTTP_STATUS.OK);
            }

            if (payload.action === "bet") {
                return c.json(await handleBet(payload), HTTP_STATUS.OK);
            }

            if (payload.action === "withdraw") {
                return c.json(await handleResult(payload), HTTP_STATUS.OK);
            }

            if (payload.action === "rollback") {
                return c.json(await handleRollback(payload), HTTP_STATUS.OK);
            }

            return c.json({ code: ErrorCodes.CHECKS_FAIL, message: "Invalid action" }, HTTP_STATUS.OK);
        } catch (error) {
            logger.error(error);
            return apiError(
                c,
                "Internal server error",
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }
    });
};

const handleSessionInit = async (payload: any) => {
    const sessionInitData = SessionInitSchema.parse(payload);

    const game = await prisma.inoutGame.findUnique({
        where: { gameMode: sessionInitData.data.gameMode },
        select: { id: true },
    });

    if (!game) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Game not found" }
    }

    const user = await prisma.user.findUnique({
        where: { id: sessionInitData.token },
        select: { id: true, balance: true, username: true },
    });

    if (!user) {
        return { code: ErrorCodes.ACCOUNT_INVALID, message: "Account invalid" }
    }

    return {
        code: ErrorCodes.OK,
        userId: user.id,
        nickname: user.username,
        balance: user.balance.toString(),
        currency: Inout.currency,
        operator: Inout.operatorId
    }
}

const handleBet = async (payload: any) => {
    const betData = BetSchema.parse(payload);

    if (Inout.currency !== betData.data.currency) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Currency not match" }
    }

    const game = await prisma.inoutGame.findUnique({
        where: { gameMode: betData.gameMode },
        select: { id: true, category: true },
    });

    if (!game) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Game not found" }
    }

    const user = await prisma.user.findUnique({
        where: { id: betData.token },
        select: { id: true, balance: true, username: true, isDemo: true },
    });

    if (!user) {
        return { code: ErrorCodes.ACCOUNT_INVALID, message: "Account invalid" }
    }

    if (user.isDemo) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Demo accounts cannot play third-party games" }
    }

    const betAmount = Number(betData.data.amount)

    if (betAmount > user.balance) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Not enough balance" }
    }

    const betRow = await prisma.inoutBet.create({
        data: {
            user: {
                connect: {
                    id: user.id,
                },
            },
            betAmount: betAmount,
            currency: betData.data.currency,
            gameId: betData.data.gameId,
            gameMode: betData.gameMode,
            operator: betData.data.operator,
            transactionId: betData.data.transactionId,
            token: betData.token,
            isSettled: false,
            winAmount: 0,
        },
    });

    const updatedUser = await prisma.user.update({
        where: {
            id: user.id,
        },
        data: {
            balance: {
                decrement: betAmount,
            },
            xp: {
                increment: betAmount,
            },
        },
        select: {
            balance: true,
        },
    });

    WebSocketManager.publishToUser(
        user.id,
        "account-balance",
        { balance: updatedUser.balance }
    );

    // Fresh game history after third-party bet
    await Cache.invalidateUserGameCaches(
        user.id,
        CacheKey.inoutBets(user.id)
    );

    // Team Agent commission is priced at IST 24:00 (ADR-0036), not on place.

    // Self-rebate: 0.1% cashback (async, non-blocking)
    SelfRebateCalculator.accrueForBet({
        userId: user.id,
        betAmount,
        game: "INOUT",
        betId: betRow.id,
        inoutCategory: game.category ?? null,
    }).catch((err) =>
        logger.error("Error accruing self-rebate:", err)
    );

    // Fire-and-forget: Check activity bonuses
            // checkAndCreateWeeklyBonuses(user.id); // WEEKLY_BONUS_ENABLED=false — re-enable later
    checkAndCreateDailyBonuses(user.id);

    return {
        code: ErrorCodes.OK,
        balance: updatedUser.balance.toString(),
    }
}

const handleResult = async (payload: any) => {
    const resultData = ResultSchema.parse(payload);

    const game = await prisma.inoutGame.findUnique({
        where: { gameMode: resultData.gameMode },
        select: { id: true },
    });

    if (!game) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Game not found" }
    }

    const user = await prisma.user.findUnique({
        where: { id: resultData.token },
        select: { id: true, balance: true, username: true },
    });

    if (!user) {
        return { code: ErrorCodes.ACCOUNT_INVALID, message: "Account invalid" }
    }

    const bet = await prisma.inoutBet.findUnique({
        where: { transactionId: resultData.data.debitId }
    })

    if (!bet) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Bet not found with given debitId" }
    }

    let balanceToReturn = user.balance

    if (bet.isSettled) {
        return {
            code: ErrorCodes.OK,
            balance: balanceToReturn.toString(),
        }
    }

    const betAmount = Number(resultData.data.amount)
    const resultAmount = Number(resultData.data.result)
    let winAmount = 0

    // handle win
    if (resultAmount >= betAmount) {
        const updatedUser = await prisma.user.update({
            where: {
                id: user.id,
            },
            data: {
                balance: {
                    increment: resultAmount,
                },
            },
            select: {
                id: true,
                balance: true,
            },
        });

        WebSocketManager.publishToUser(
            updatedUser.id,
            "account-balance",
            { balance: updatedUser.balance }
        );

        winAmount = resultAmount
        balanceToReturn = updatedUser.balance

        // return {
        //     code: ErrorCodes.OK,
        //     balance: updatedUser.balance.toString(),
        // }
    }

    await prisma.inoutBet.update({
        where: {
            id: bet.id
        },
        data: {
            winAmount,
            isSettled: true
        }
    })

    await Cache.invalidateUserGameCaches(
        user.id,
        CacheKey.inoutBets(user.id)
    );

    return {
        code: ErrorCodes.OK,
        balance: balanceToReturn.toString(),
    }
}

const handleRollback = async (payload: any) => {
    const rollbackData = RollbackSchema.parse(payload);

    const game = await prisma.inoutGame.findUnique({
        where: { gameMode: rollbackData.gameMode },
        select: { id: true },
    });

    if (!game) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Game not found" }
    }

    const user = await prisma.user.findUnique({
        where: { id: rollbackData.token },
        select: { id: true, balance: true, username: true },
    });

    if (!user) {
        return { code: ErrorCodes.ACCOUNT_INVALID, message: "Account invalid" }
    }

    const bet = await prisma.inoutBet.findUnique({
        where: { transactionId: rollbackData.data.debitId }
    })

    if (!bet) {
        return { code: ErrorCodes.CHECKS_FAIL, message: "Bet not found with given debitId" }
    }

    if (bet.isRolledback) {
        return {
            code: ErrorCodes.OK,
            balance: user.balance.toString(),
        }
    }

    const amount = Number(rollbackData.data.amount)

    const updatedUser = await prisma.user.update({
        where: {
            id: user.id,
        },
        data: {
            balance: {
                increment: amount,
            },
        },
        select: {
            id: true,
            balance: true,
        },
    });

    await prisma.inoutBet.update({
        where: {
            id: bet.id
        },
        data: {
            isRolledback: true,
            winAmount: 0
        }
    })

    await Cache.invalidateUserGameCaches(
        user.id,
        CacheKey.inoutBets(user.id)
    );

    WebSocketManager.publishToUser(
        updatedUser.id,
        "account-balance",
        { balance: updatedUser.balance }
    );

    return {
        code: ErrorCodes.OK,
        balance: updatedUser.balance.toString(),
    }
}