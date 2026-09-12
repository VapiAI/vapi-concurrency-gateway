import type { PoolClient } from "pg";
import { pool } from "./db/pool.js";

export type EventKind =
  | "admit"
  | "reject"
  | "release"
  | "adopt"
  | "reconcile-release"
  | "cap-change";

export type EventRecord = {
  kind: EventKind;
  tenantId?: string | null;
  callId?: string | null;
  correlationId?: string | null;
  detail?: Record<string, unknown>;
};

export type StoredEvent = Required<Omit<EventRecord, "detail">> & {
  id: string;
  at: string;
  detail: Record<string, unknown>;
};

/**
 * Pass `client` to append inside a caller's transaction. Admission always does,
 * so an event can never survive a rolled back state change.
 */
export async function appendEvent(
  record: EventRecord,
  client?: PoolClient,
): Promise<void> {
  const runner = client ?? pool;
  await runner.query(
    `INSERT INTO events (kind, tenant_id, call_id, correlation_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      record.kind,
      record.tenantId ?? null,
      record.callId ?? null,
      record.correlationId ?? null,
      JSON.stringify(record.detail ?? {}),
    ],
  );
}

export async function listEvents(limit = 200): Promise<StoredEvent[]> {
  const { rows } = await pool.query<{
    id: string;
    at: Date;
    kind: EventKind;
    tenant_id: string | null;
    call_id: string | null;
    correlation_id: string | null;
    detail: Record<string, unknown>;
  }>(
    `SELECT id, at, kind, tenant_id, call_id, correlation_id, detail
       FROM events ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    kind: row.kind,
    tenantId: row.tenant_id,
    callId: row.call_id,
    correlationId: row.correlation_id,
    detail: row.detail,
  }));
}

export async function countEventsByKind(kind: EventKind): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE kind = $1",
    [kind],
  );
  return rows[0]?.n ?? 0;
}
