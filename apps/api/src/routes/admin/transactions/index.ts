import { OpenAPIHono } from "@hono/zod-openapi";

import { withdrawRoutes } from "./withdraw";
import { depositRoutes } from "./deposit";
import { balanceTransactionRoutes } from "./balanceUpdate";
import { gameHistoryRoutes } from "./gameHistory";
import { commissionHistoryRoutes } from "./commissionHistory";
import { activityBonusHistoryRoutes } from "./activityBonusHistory";
import { rebateHistoryRoutes } from "./rebateHistory";

export const transactionRoutes = (app: OpenAPIHono) => {
    withdrawRoutes(app);
    depositRoutes(app);
    balanceTransactionRoutes(app);
    gameHistoryRoutes(app);
    commissionHistoryRoutes(app);
    activityBonusHistoryRoutes(app);
    rebateHistoryRoutes(app);
};
