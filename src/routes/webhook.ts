import { Router, type Response } from "express";
import { config } from "../config.js";
import { release, reserve } from "../admission.js";
import { resolveByPhoneNumberId, type Tenant } from "../tenants.js";
import { buildTransientAdmission } from "../transientAssistant.js";
import { isTerminalStatus } from "../vapi.js";

/**
 * Spoken to the caller when the gateway cannot identify which tenant a call
 * belongs to. Deliberately tenant-agnostic, and deliberately non-empty: an
 * empty-string `error` skips the platform's error branch and makes Vapi speak
 * `Unknown Error. Contact Support.` instead.
 */
export const GENERIC_REJECT_MESSAGE =
  "We are unable to take your call right now. Please try again shortly.";

type ServerMessage = {
  type?: unknown;
  status?: unknown;
  endedReason?: unknown;
  phoneNumber?: { id?: unknown } | null;
  call?: { id?: unknown } | null;
};

/**
 * The admission response.
 *
 * Returns a TRANSIENT assistant, not an assistant id, because the ISV builds
 * its clients' assistants per call rather than storing one per client. With no
 * assistant id there is nothing to join a call back to a tenant, so the
 * overrides also carry the tenant id and a per-call token as metadata. That is
 * what makes a call attributable from the Vapi side alone, including one
 * admitted on the fail-open path while this gateway's database was unreachable.
 *
 */
function admitBody(tenant: Tenant) {
  return buildTransientAdmission(tenant);
}

export function createWebhookRouter(): Router {
  const router = Router();

  router.post("/webhook", async (req, res) => {
    const expected = process.env.WEBHOOK_SECRET ?? config.webhookSecret;
    const presented = req.header("x-vapi-secret") ?? "";

    if (!expected || presented !== expected) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const message = (req.body?.message ?? {}) as ServerMessage;

    try {
      if (message.type === "assistant-request") {
        await handleAssistantRequest(message, res);
        return;
      }

      if (message.type === "status-update") {
        await handleStatusUpdate(message);
        res.status(200).json({});
        return;
      }

      res.status(200).json({});
    } catch (error) {
      // A 5xx here yields `assistant-request-failed`, which is a worse caller
      // outcome than anything this handler could return. So never propagate.
      console.error("[webhook] unhandled error", error);
      if (!res.headersSent) {
        res
          .status(200)
          .json(
            message.type === "assistant-request"
              ? { error: GENERIC_REJECT_MESSAGE }
              : {},
          );
      }
    }
  });

  return router;
}

async function handleAssistantRequest(
  message: ServerMessage,
  res: Response,
): Promise<void> {
  const phoneNumberId = message.phoneNumber?.id;
  const callId = message.call?.id;

  if (typeof phoneNumberId !== "string" || typeof callId !== "string") {
    res.status(200).json({ error: GENERIC_REJECT_MESSAGE });
    return;
  }

  const tenant = await resolveByPhoneNumberId(phoneNumberId);

  if (!tenant) {
    // An unrecognized id is refused rather than admitted, so someone who
    // guesses this endpoint cannot mint reservations by naming a tenant. This
    // is also the "tenant cannot be resolved at all" case: there is nothing to
    // admit the call to, so pretending to admit is not an option.
    res.status(200).json({ error: GENERIC_REJECT_MESSAGE });
    return;
  }

  const result = await reserve({ tenant, callId, direction: "inbound" });
  res.status(200).json(
    result.admitted ? admitBody(tenant) : { error: tenant.rejectMessage },
  );
}

async function handleStatusUpdate(message: ServerMessage): Promise<void> {
  const callId = message.call?.id;
  if (typeof callId !== "string") {
    return;
  }

  const status =
    typeof message.status === "string" ? message.status : undefined;
  const terminal = isTerminalStatus(status);
  const endedReason =
    typeof message.endedReason === "string" ? message.endedReason : undefined;

  // Terminal status only. `forwarding` is emitted while the call is still live
  // and Vapi keeps consuming the line on a warm transfer, so it must not
  // release. Non-terminal statuses are acknowledged and ignored.
  if (!terminal) {
    return;
  }

  await release({ callId, cause: endedReason ?? "ended" });
}
