import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  adopt,
  releasePending,
  reservePending,
} from "../admission.js";
import {
  getTenant,
  resolveByAssistantId,
  resolveByPhoneNumberId,
} from "../tenants.js";
import {
  createCall as createCallLive,
} from "../vapi.js";
import { asyncHandler } from "./asyncHandler.js";

type DialBody = {
  tenantId?: unknown;
  phoneNumberId?: unknown;
  customerNumber?: unknown;
  assistantId?: unknown;
};

export function createDialRouter(
  deps: {
    createCall?: (
      input: Parameters<typeof createCallLive>[0],
    ) => ReturnType<typeof createCallLive>;
  } = {},
): Router {
  const createCall = deps.createCall ?? createCallLive;
  const router = Router();

  router.post(
    "/dial",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as DialBody;

      if (
        typeof body.tenantId !== "string" ||
        typeof body.phoneNumberId !== "string" ||
        typeof body.customerNumber !== "string" ||
        typeof body.assistantId !== "string"
      ) {
        res.status(400).json({
          error:
            "tenantId, phoneNumberId, customerNumber, and assistantId are required strings",
        });
        return;
      }

      const tenant = await getTenant(body.tenantId);
      if (!tenant) {
        res.status(404).json({ error: `Unknown tenant ${body.tenantId}` });
        return;
      }

      // The number must belong to this tenant. Without this check an operator
      // could bill one tenant's cap while dialing from another's line.
      const numberOwner = await resolveByPhoneNumberId(body.phoneNumberId);
      if (!numberOwner || numberOwner.id !== tenant.id) {
        res.status(400).json({
          error: `phoneNumberId ${body.phoneNumberId} does not belong to tenant ${tenant.id}`,
        });
        return;
      }

      const assistantOwner = await resolveByAssistantId(body.assistantId);
      if (!assistantOwner || assistantOwner.id !== tenant.id) {
        res.status(400).json({
          error: `assistantId ${body.assistantId} does not belong to tenant ${tenant.id}`,
        });
        return;
      }

      // Keep the temporary reservation keyed separately until Vapi returns
      // the real call id.
      const correlationId = randomUUID();
      const reservation = await reservePending({ tenant, correlationId });

      if (!reservation.admitted) {
        // A tombstone is not a cap condition. Unreachable today, since this
        // route mints its own correlation id per request, but answering 429
        // with cap text would tell a caller to back off when the real problem
        // is a replayed id. The machine-readable `reason` was already right;
        // the status code and the human-readable string were not.
        if (reservation.reason === "tombstoned") {
          res.status(409).json({
            error: `Correlation id ${correlationId} has already completed`,
            reason: reservation.reason,
          });
          return;
        }

        res.status(429).json({
          error: `Tenant ${tenant.id} is at its concurrency cap`,
          reason: reservation.reason,
          used: reservation.used,
          cap: reservation.cap,
        });
        return;
      }

      try {
        const outcome = await createCall({
          assistantId: body.assistantId,
          phoneNumberId: body.phoneNumberId,
          customerNumber: body.customerNumber,
        });
        await adopt({ correlationId, callId: outcome.callId });
        res.status(201).json({
          callId: outcome.callId,
          correlationId,
          used: reservation.used,
          cap: reservation.cap,
        });
        return;
      } catch (error) {
        // This example treats a Vapi failure as a failed outbound attempt. A
        // production system may retain this hold and reconcile it later.
        await releasePending({ correlationId, cause: "vapi-dial-failed" });
        res.status(502).json({
          error: "Vapi could not start the call",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  return router;
}
