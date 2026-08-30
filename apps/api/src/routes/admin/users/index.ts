import { OpenAPIHono } from "@hono/zod-openapi";

import { listRoutes } from "./list";
import { statsRoutes } from "./stats";
import { banRoutes } from "./ban";
import { unbanRoutes } from "./unban";
import { balanceRoutes } from "./balance";
import { penaltyRoutes } from "./penalty";
import { createUserRoutes } from "./create";
import { inviteTreeRoutes } from "./inviteTree";
import { yesterdayStatsRoutes } from "./yesterdayStats";
import { teamDayAnalysisRoutes } from "./teamDayAnalysis";

export const userManagementRoutes = (app: OpenAPIHono) => {
    listRoutes(app);
    createUserRoutes(app);
    inviteTreeRoutes(app);
    statsRoutes(app);
    yesterdayStatsRoutes(app);
    teamDayAnalysisRoutes(app);
    banRoutes(app);
    unbanRoutes(app);
    balanceRoutes(app);
    penaltyRoutes(app);
};
