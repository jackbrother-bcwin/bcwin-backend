import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { activityProgressRoutes } from "./progress";
import { activityBonusesRoutes } from "./bonuses";
import { activityClaimRoutes } from "./claim";
import { activityHistoryRoutes } from "./history";
import { spinWheelRoutes } from "./spinWheel";
import { luckySpinUserRoutes } from "./luckySpin";
import { winStreakProgressRoutes } from "./winStreak";
import { activityTiersRoutes } from "./tiers";

export const activityRoutes = (app: OpenAPIHono) => {
    const activityApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    activityProgressRoutes(activityApp);
    activityBonusesRoutes(activityApp);
    activityClaimRoutes(activityApp);
    activityHistoryRoutes(activityApp);
    spinWheelRoutes(activityApp);
    luckySpinUserRoutes(activityApp);
    winStreakProgressRoutes(activityApp);
    activityTiersRoutes(activityApp);

    app.route("/activity", activityApp);
};
