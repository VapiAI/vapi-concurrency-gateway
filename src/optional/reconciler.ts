import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { appendEvent } from "../events.js";
import { release } from "../admission.js";
import { isTerminalStatus, readCall } from "../vapi.js";

/**
 * Optional safety net for deployments that want to recover from a missed
 * terminal webhook. It never changes a slot unless Vapi explicitly says the
 * call ended. The normal gateway flow does not need this worker.
 */
export async function reconcileOnce(): Promise<void> {
  const { rows } = await pool.query<{ call_id: string; tenant_id: string }>(
    "SELECT call_id, tenant_id FROM reservations WHERE state = 'reserved' AND call_id IS NOT NULL",
  );
  for (const row of rows) {
    const outcome = await readCall(row.call_id);
    if (outcome.kind === "read" && isTerminalStatus(outcome.status)) {
      await release({ callId: row.call_id, cause: outcome.endedReason ?? "reconciled-ended" });
      await appendEvent({ kind: "reconcile-release", tenantId: row.tenant_id,
        callId: row.call_id, detail: {} });
    }
  }
}

export function startReconciler(): () => void {
  const timer = setInterval(() => reconcileOnce().catch((error) => {
    console.error("[reconciler] sweep failed", error);
  }), config.reconcileIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
