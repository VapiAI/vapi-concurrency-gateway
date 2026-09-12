import { Router } from "express";
import { pool } from "../db/pool.js";
import { clear, endCall, fill } from "../demo/simulate.js";
import { appendEvent } from "../events.js";
import { getTenant } from "../tenants.js";
import { asyncHandler } from "./asyncHandler.js";

/**
 * DEMO ONLY. Mounted only when `DEMO_MODE=true`, so a real deployment never
 * exposes any of it. Delete this file and `src/demo/` to remove it entirely.
 *
 * The cap control lives here rather than in the gateway proper on purpose. In
 * a real deployment a client's cap comes from whatever the ISV already bills
 * against, not from a button on a dashboard. Here it exists so a presenter can
 * drop a tenant to one line and show two live calls fighting over it.
 */
export function createDemoRouter(): Router {
  const router = Router();

  router.post(
    "/demo/tenants/:tenantId/fill",
    asyncHandler(async (req, res) => {
      const result = await fill(req.params.tenantId).catch(() => undefined);
      if (!result) {
        res.status(404).json({ error: `Unknown tenant ${req.params.tenantId}` });
        return;
      }
      res.status(200).json(result);
    }),
  );

  router.post(
    "/demo/tenants/:tenantId/clear",
    asyncHandler(async (req, res) => {
      res.status(200).json(await clear(req.params.tenantId));
    }),
  );

  router.post(
    "/demo/calls/:callId/end",
    asyncHandler(async (req, res) => {
      const ended = await endCall(req.params.callId);
      if (!ended) {
        res
          .status(400)
          .json({ error: "Only simulated calls can be ended from here." });
        return;
      }
      res.status(200).json({ ended: true });
    }),
  );

  router.patch(
    "/demo/tenants/:tenantId/cap",
    asyncHandler(async (req, res) => {
      const cap = (req.body as { cap?: unknown })?.cap;
      if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 0) {
        res.status(400).json({ error: "cap must be a non-negative integer" });
        return;
      }

      const tenant = await getTenant(req.params.tenantId);
      if (!tenant) {
        res.status(404).json({ error: `Unknown tenant ${req.params.tenantId}` });
        return;
      }

      await pool.query(
        "UPDATE tenants SET cap = $2, updated_at = now() WHERE id = $1",
        [tenant.id, cap],
      );

      // Lowering below current usage is allowed. Nobody is cut off; the tenant
      // drains, which falls out of the `used >= cap` check in reserve for free.
      await appendEvent({
        kind: "cap-change",
        tenantId: tenant.id,
        detail: {
          previousCap: tenant.cap,
          currentCap: cap,
          direction:
            cap > tenant.cap ? "raised" : cap < tenant.cap ? "lowered" : "same",
        },
      });

      res.status(200).json({ cap });
    }),
  );

  return router;
}
