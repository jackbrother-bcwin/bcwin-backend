import { OpenAPIHono } from "@hono/zod-openapi";
import { prisma } from "@bcwin/db";
import { TRX_WINGO_BETS_LIVE } from "@bcwin/config";
import { acceptTrxEntry, endTrxVisit, getTrxEntry, TrxEntryError } from "@/lib/trxEntry";
import { rejectIfTrxWingoBetsPaused } from "@/lib/trxWingoPauseGate";

export function entryRoutes(app: OpenAPIHono) {
    app.get("/entry", async (c) => {
        if (!TRX_WINGO_BETS_LIVE) return c.json({ success: true, data: { available: false, active: false } });
        return c.json({ success: true, data: await getTrxEntry(c.get("user").id) });
    });
    app.post("/entry", async (c) => {
        const paused = rejectIfTrxWingoBetsPaused(c);
        if (paused) return paused;
        const body = await c.req.json().catch(() => null);
        if (typeof body?.quote !== "string" || body.quote.length > 8192) {
            return c.json({ success: false, error: "A valid entry quote is required" }, 400);
        }
        try {
            return c.json({ success: true, data: await acceptTrxEntry(c.get("user").id, body.quote) });
        } catch (error) {
            if (error instanceof TrxEntryError) return c.json({ success: false, error: error.message }, 409);
            throw error;
        }
    });
    app.post("/entry/exit", async (c) => {
        const body = await c.req.json().catch(() => null);
        if (typeof body?.visitId !== "string" || !body.visitId || body.visitId.length > 100) {
            return c.json({ success: false, error: "A visit ID is required" }, 400);
        }
        await prisma.$transaction((tx) => endTrxVisit(tx, c.get("user").id, body.visitId));
        return c.json({ success: true });
    });
}
