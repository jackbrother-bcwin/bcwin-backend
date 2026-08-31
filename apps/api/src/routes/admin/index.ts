import { OpenAPIHono } from "@hono/zod-openapi";

import { zodErrorHook } from "@/lib/utils";
import { overviewRoutes } from "./overview";
import { setResultsRoutes } from "./setResults";
import { giftRoutes } from "./gift";
import { transactionRoutes } from "./transactions";
import { userManagementRoutes } from "./users";
import { configRoutes } from "./config";
import { subAdminRoutes } from "./subAdmin/subAdmin";
import { agentRoutes } from "./agent";
import { illegalBetsManagementRoutes } from "./illegalBets";
import { ipRoutes } from "./ip";
import { updateInoutGamesRoutes } from "./updateInoutGames";
import { profitLossRoutes } from "./profitLoss";
import { topPerformanceRoutes } from "./topPerformance";
import { queriesRoutes } from "./queries";
import { salaryRoutes } from "./salary";
import { salaryLeadersRoutes } from "./salaryLeaders";
import { vipRulesRoutes } from "./vipRules";
import { adminBankRoutes } from "./bank";
import { activityBonusSettingsRoutes } from "./activityBonusSettings";
import { luckySpinAdminRoutes } from "./luckySpin";
import { winStreakRulesRoutes } from "./winStreakRules";
import { turnoverRoutes } from "./turnover";
import { dashboardInsightsRoutes } from "./dashboardInsights";

export const adminRoutes = (app: OpenAPIHono) => {
    const adminApp = new OpenAPIHono({ defaultHook: zodErrorHook });

    overviewRoutes(adminApp);
    dashboardInsightsRoutes(adminApp);
    setResultsRoutes(adminApp);

    // Mount profit and loss routes under /admin/profit-loss
    const profitLossApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    profitLossRoutes(profitLossApp);
    adminApp.route("/profit-loss", profitLossApp);

    // Mount top performance routes under /admin/top-performance
    const topPerformanceApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    topPerformanceRoutes(topPerformanceApp);
    adminApp.route("/top-performance", topPerformanceApp);

    // Mount withdraw routes under /admin/withdraw
    const transactionApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    transactionRoutes(transactionApp);
    adminApp.route("/transactions", transactionApp);

    // Mount user management routes under /admin/users
    const userApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    userManagementRoutes(userApp);
    adminApp.route("/users", userApp);

    // Mount config routes under /admin/config
    const configApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    configRoutes(configApp);
    adminApp.route("/config", configApp);

    // Mount sub-admin routes under /admin/subadmin
    const subAdminApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    subAdminRoutes(subAdminApp);
    adminApp.route("/subadmin", subAdminApp);

    // Mount agent routes under /admin/agent
    const agentApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    agentRoutes(agentApp);
    adminApp.route("/agent", agentApp);

    giftRoutes(adminApp);

    // Mount illegal bets routes under /admin/illegal-bets
    const illegalBetsApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    illegalBetsManagementRoutes(illegalBetsApp);
    adminApp.route("/illegal-bets", illegalBetsApp);

    // Mount IP management routes under /admin/ip
    const ipApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    ipRoutes(ipApp);
    adminApp.route("/ip", ipApp);

    // Mount queries routes under /admin/queries
    const queriesApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    queriesRoutes(queriesApp);
    adminApp.route("/queries", queriesApp);

    // Mount salary routes under /admin/salary
    const salaryApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    salaryRoutes(salaryApp);
    adminApp.route("/salary", salaryApp);

    // Curated Salary Leaders membership list (separate from salary payouts)
    const salaryLeadersApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    salaryLeadersRoutes(salaryLeadersApp);
    adminApp.route("/salary-leaders", salaryLeadersApp);

    // Mount VIP rules routes under /admin/vip-rules
    const vipRulesApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    vipRulesRoutes(vipRulesApp);
    adminApp.route("/vip-rules", vipRulesApp);

    // Mount user bank routes under /admin/bank
    const bankApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    adminBankRoutes(bankApp);
    adminApp.route("/bank", bankApp);

    updateInoutGamesRoutes(adminApp);
    activityBonusSettingsRoutes(adminApp);
    luckySpinAdminRoutes(adminApp);

    // Mount win streak rules under /admin/win-streak-rules
    const winStreakApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    winStreakRulesRoutes(winStreakApp);
    adminApp.route("/win-streak-rules", winStreakApp);

    // Mount turnover management under /admin/turnover
    const turnoverApp = new OpenAPIHono({ defaultHook: zodErrorHook });
    turnoverRoutes(turnoverApp);
    adminApp.route("/turnover", turnoverApp);

    app.route("/admin", adminApp);
};
