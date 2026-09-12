import { randomUUID } from "node:crypto";
import { release, reserve, usedForTenant } from "../admission.js";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { getTenant } from "../tenants.js";

/**
 * DEMO ONLY. Lets a presenter fill a tenant's lines without dialling real
 * phones, so the cap can be shown holding in a room with one handset.
 *
 * Not a back door. Every simulated call goes through the same `reserve` the
 * webhook uses, takes the same row lock, and is refused at the cap exactly as
 * a real call is. The only fiction is that no audio exists behind the slot.
 *
 * Simulated calls carry a `sim_` call id and every statement here is scoped to
 * that prefix, so nothing in this file can touch a live call.
 *
 * Delete `src/demo/` and `src/routes/demo.ts` to remove all of it.
 */
export const SIMULATED_PREFIX = "sim_";

/** Tenants currently cycling. Held in memory: a demo, not durable state. */
const cycling = new Set<string>();

/** When a tenant's line last came free, so the gap stays visible. */
const freedAt = new Map<string, number>();

/** When a tenant last came back up to its cap, so the hold is not instant. */
const filledAt = new Map<string, number>();

export function isCycling(tenantId: string): boolean {
  return cycling.has(tenantId);
}

async function simulatedCallIds(tenantId: string): Promise<string[]> {
  const { rows } = await pool.query<{ call_id: string }>(
    `SELECT call_id FROM reservations
      WHERE tenant_id = $1 AND state IN ('pending', 'reserved')
        AND call_id LIKE 'sim\\_%'
      ORDER BY reserved_at ASC`,
    [tenantId],
  );
  return rows.map((row) => row.call_id);
}

/**
 * Fills a tenant up to its cap with simulated calls and starts it cycling.
 *
 * Stops at the cap rather than past it, so the control cannot be used to
 * breach the limit this service exists to enforce.
 */
export async function fill(
  tenantId: string,
): Promise<{ added: number; used: number; cap: number }> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new Error(`Unknown tenant ${tenantId}`);

  let added = 0;
  for (let i = 0; i < tenant.cap; i += 1) {
    const result = await reserve({
      tenant,
      callId: `${SIMULATED_PREFIX}${randomUUID()}`,
      direction: "inbound",
    });
    if (!result.admitted) break;
    added += 1;
  }

  cycling.add(tenantId);
  const used = await usedForTenant(tenantId);
  if (used >= tenant.cap) filledAt.set(tenantId, Date.now());
  freedAt.delete(tenantId);
  return { added, used, cap: tenant.cap };
}

/**
 * Ends one call. Refuses anything that is not simulated.
 *
 * Starts the tenant's free window, not the call's. Keyed by call id the cycle
 * would never see it, and a line ended by hand would be taken straight back on
 * the next tick, which makes the button look broken.
 */
export async function endCall(callId: string): Promise<boolean> {
  if (!callId.startsWith(SIMULATED_PREFIX)) return false;

  const { rows } = await pool.query<{ tenant_id: string | null }>(
    "SELECT tenant_id FROM reservations WHERE call_id = $1",
    [callId],
  );
  const tenantId = rows[0]?.tenant_id;

  await release({ callId, cause: "demo-ended" });

  if (tenantId) {
    freedAt.set(tenantId, Date.now());
    filledAt.delete(tenantId);
  }
  return true;
}

/** Ends every simulated call for a tenant and stops it cycling. */
export async function clear(
  tenantId: string,
): Promise<{ ended: number; used: number }> {
  cycling.delete(tenantId);
  filledAt.delete(tenantId);
  freedAt.delete(tenantId);
  const ids = await simulatedCallIds(tenantId);
  for (const callId of ids) await release({ callId, cause: "demo-cleared" });
  return { ended: ids.length, used: await usedForTenant(tenantId) };
}

/**
 * One tick of the cycle. A cycling tenant sitting at its cap gives up its
 * oldest simulated line, waits, then takes it back.
 *
 * The wait is the point. Releasing and refilling in the same tick would make
 * the below-cap state last milliseconds, so nobody watching would ever see the
 * number move, which is the only thing this exists to show.
 */
export async function tick(nowMs = Date.now()): Promise<void> {
  for (const tenantId of cycling) {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      cycling.delete(tenantId);
      continue;
    }

    const used = await usedForTenant(tenantId);

    if (used >= tenant.cap) {
      // Hold at the cap for a while before giving a line up. This is the state
      // worth narrating, so it gets the longer half of the loop.
      const held = filledAt.get(tenantId);
      if (held !== undefined && nowMs - held < config.demo.holdMs) continue;

      const [oldest] = await simulatedCallIds(tenantId);
      // Every line is a real call. Leave it alone and let the cycle idle.
      if (!oldest) continue;
      await release({ callId: oldest, cause: "demo-ended" });
      freedAt.set(tenantId, nowMs);
      filledAt.delete(tenantId);
      continue;
    }

    const since = freedAt.get(tenantId);
    if (since !== undefined && nowMs - since < config.demo.freeMs) continue;

    const result = await reserve({
      tenant,
      callId: `${SIMULATED_PREFIX}${randomUUID()}`,
      direction: "inbound",
    });
    if (!result.admitted) {
      cycling.delete(tenantId);
      continue;
    }
    // Only start the hold clock once the tenant is actually back at its cap.
    if ((await usedForTenant(tenantId)) >= tenant.cap) {
      filledAt.set(tenantId, nowMs);
    }
  }
}

export function startCycle(): () => void {
  const timer = setInterval(() => {
    tick().catch((error) => console.error("[demo] cycle tick failed", error));
  }, config.demo.tickMs);
  timer.unref();
  return () => clearInterval(timer);
}
