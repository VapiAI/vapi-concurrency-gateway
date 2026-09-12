import type { PoolClient } from "pg";
import { pool, withTransaction } from "./db/pool.js";
import { appendEvent } from "./events.js";
import type { Tenant } from "./tenants.js";

export type Direction = "inbound" | "outbound";
type ActiveState = "pending" | "reserved";

export type ReserveResult =
  | { admitted: true; used: number; cap: number; reservationId: string }
  | { admitted: false; used: number; cap: number; reason: "at-cap" | "tombstoned" };

async function usedInTransaction(client: PoolClient, tenantId: string): Promise<number> {
  const { rows } = await client.query<{ used: number }>(
    `SELECT count(*)::int AS used FROM reservations
      WHERE tenant_id = $1 AND state IN ('pending', 'reserved')`,
    [tenantId],
  );
  return rows[0]?.used ?? 0;
}

export async function usedForTenant(tenantId: string): Promise<number> {
  const { rows } = await pool.query<{ used: number }>(
    `SELECT count(*)::int AS used FROM reservations
      WHERE tenant_id = $1 AND state IN ('pending', 'reserved')`,
    [tenantId],
  );
  return rows[0]?.used ?? 0;
}

/** Holds one tenant line for an inbound call. */
export async function reserve(input: {
  tenant: Tenant;
  callId: string;
  direction: Direction;
}): Promise<ReserveResult> {
  return withTransaction(async (client) => {
    // Lock before counting so concurrent requests share one cap decision.
    const locked = await client.query<{ cap: number }>(
      "SELECT cap FROM tenants WHERE id = $1 FOR UPDATE",
      [input.tenant.id],
    );
    const cap = locked.rows[0]?.cap ?? input.tenant.cap;
    const existing = await client.query<{ id: string; state: string }>(
      "SELECT id, state FROM reservations WHERE call_id = $1",
      [input.callId],
    );
    const used = await usedInTransaction(client, input.tenant.id);

    if (existing.rows[0]?.state === "released") {
      return { admitted: false, used, cap, reason: "tombstoned" };
    }
    if (existing.rows[0]) {
      return { admitted: true, used, cap, reservationId: existing.rows[0].id };
    }
    if (used >= cap) {
      await appendEvent({ kind: "reject", tenantId: input.tenant.id, callId: input.callId,
        detail: { used, cap, direction: input.direction } }, client);
      return { admitted: false, used, cap, reason: "at-cap" };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reservations (tenant_id, state, call_id, direction)
       VALUES ($1, 'reserved', $2, $3) RETURNING id`,
      [input.tenant.id, input.callId, input.direction],
    );
    await appendEvent({ kind: "admit", tenantId: input.tenant.id, callId: input.callId,
      detail: { used: used + 1, cap, direction: input.direction } }, client);
    return { admitted: true, used: used + 1, cap, reservationId: inserted.rows[0].id };
  });
}

/** Releases a line when Vapi sends its normal terminal status update. */
export async function release(input: { callId: string; cause: string }): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query<{ tenant_id: string | null }>(
      `UPDATE reservations SET state = 'released', released_at = now(), release_cause = $2
       WHERE call_id = $1 AND state IN ('pending', 'reserved') RETURNING tenant_id`,
      [input.callId, input.cause],
    );
    if (updated.rows[0]) {
      await appendEvent({ kind: "release", tenantId: updated.rows[0].tenant_id,
        callId: input.callId, detail: { cause: input.cause } }, client);
      return;
    }

    // Vapi also posts ended for calls rejected at admission. Tombstoning makes
    // a late duplicate admission for that same call harmless.
    await client.query(
      `INSERT INTO reservations (state, call_id, direction, released_at, release_cause)
       VALUES ('released', $1, 'inbound', now(), $2)
       ON CONFLICT (call_id) WHERE call_id IS NOT NULL DO NOTHING`,
      [input.callId, input.cause],
    );
  });
}

/** Outbound reserves before Vapi returns a call id, then adopts that id. */
export async function reservePending(input: {
  tenant: Tenant;
  correlationId: string;
}): Promise<ReserveResult> {
  return withTransaction(async (client) => {
    const locked = await client.query<{ cap: number }>(
      "SELECT cap FROM tenants WHERE id = $1 FOR UPDATE", [input.tenant.id],
    );
    const cap = locked.rows[0]?.cap ?? input.tenant.cap;
    const used = await usedInTransaction(client, input.tenant.id);
    if (used >= cap) return { admitted: false, used, cap, reason: "at-cap" };

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reservations (tenant_id, state, correlation_id, direction)
       VALUES ($1, 'pending', $2, 'outbound') RETURNING id`,
      [input.tenant.id, input.correlationId],
    );
    await appendEvent({ kind: "admit", tenantId: input.tenant.id,
      correlationId: input.correlationId, detail: { used: used + 1, cap, direction: "outbound" } }, client);
    return { admitted: true, used: used + 1, cap, reservationId: inserted.rows[0].id };
  });
}

export async function adopt(input: { correlationId: string; callId: string }): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query<{ tenant_id: string }>(
      `UPDATE reservations SET state = 'reserved', call_id = $2
       WHERE correlation_id = $1 AND state = 'pending' RETURNING tenant_id`,
      [input.correlationId, input.callId],
    );
    if (updated.rows[0]) {
      await appendEvent({ kind: "adopt", tenantId: updated.rows[0].tenant_id,
        callId: input.callId, correlationId: input.correlationId }, client);
    }
  });
}

export async function releasePending(input: { correlationId: string; cause: string }): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query<{ tenant_id: string }>(
      `UPDATE reservations SET state = 'released', released_at = now(), release_cause = $2
       WHERE correlation_id = $1 AND state = 'pending' RETURNING tenant_id`,
      [input.correlationId, input.cause],
    );
    if (updated.rows[0]) {
      await appendEvent({ kind: "release", tenantId: updated.rows[0].tenant_id,
        correlationId: input.correlationId, detail: { cause: input.cause } }, client);
    }
  });
}

export type ActiveSlot = {
  reservationId: string;
  tenantId: string;
  state: ActiveState;
  callId: string | null;
  direction: Direction;
  ageMs: number;
};

export async function findActiveSlots(): Promise<ActiveSlot[]> {
  const { rows } = await pool.query<{
    id: string; tenant_id: string; state: ActiveState; call_id: string | null;
    direction: Direction; reserved_at: Date;
  }>(`SELECT id, tenant_id, state, call_id, direction, reserved_at FROM reservations
       WHERE state IN ('pending', 'reserved') ORDER BY reserved_at ASC`);
  const now = Date.now();
  return rows.map((row) => ({ reservationId: row.id, tenantId: row.tenant_id,
    state: row.state, callId: row.call_id, direction: row.direction,
    ageMs: now - row.reserved_at.getTime() }));
}
