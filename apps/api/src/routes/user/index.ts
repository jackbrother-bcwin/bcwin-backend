import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
// import { dailyCommissionRoutes } from "./commission/daily";
// import { breakdownRoutes } from "./commission/breakdown";
// import { teamRoutes } from "./commission/team";
import { commissionRoutes } from "./commission";
import { vipRoutes } from "./vip";
import { teamRoutes } from "./team";
import { userRoutes as userUserRoutes } from "./user";
import { transactionRoutes } from "./transaction";
import { rebateRoutes } from "./rebate";
import { activityRoutes } from "./activity";
import { gameHistoryRoutes } from "./gameHistory";
import { userQueriesRoutes } from "./queries";
import { userNotificationRoutes } from "./notifications";
import { userSalaryRoutes } from "./salary";

export const userRoutes = (app: OpenAPIHono) => {
    const userApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    commissionRoutes(userApp);
    vipRoutes(userApp);
    teamRoutes(userApp);
    userUserRoutes(userApp);
    transactionRoutes(userApp);
    rebateRoutes(userApp);
    activityRoutes(userApp);
    gameHistoryRoutes(userApp);
    userQueriesRoutes(userApp);
    userNotificationRoutes(userApp);
    userSalaryRoutes(userApp);

    app.route("/user", userApp);
};
