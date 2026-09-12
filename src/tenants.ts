import { pool } from "./db/pool.js";

export const DEFAULT_REJECT_MESSAGE = "All of our lines are busy right now. Please try again shortly.";

export type Tenant = {
  id: string;
  displayName: string;
  cap: number;
  rejectMessage: string;
  voiceId: string;
};

type TenantRow = {
  id: string; display_name: string; cap: number;
  reject_message: string; voice_id: string;
};

const columns = "t.id, t.display_name, t.cap, t.reject_message, t.voice_id";
const toTenant = (row: TenantRow): Tenant => ({
  id: row.id, displayName: row.display_name, cap: row.cap,
  rejectMessage: row.reject_message, voiceId: row.voice_id,
});

export async function resolveByPhoneNumberId(phoneNumberId: string): Promise<Tenant | undefined> {
  const { rows } = await pool.query<TenantRow>(
    `SELECT ${columns} FROM tenants t JOIN tenant_phone_numbers p ON p.tenant_id = t.id
     WHERE p.phone_number_id = $1`, [phoneNumberId],
  );
  return rows[0] ? toTenant(rows[0]) : undefined;
}

export async function resolveByAssistantId(assistantId: string): Promise<Tenant | undefined> {
  const { rows } = await pool.query<TenantRow>(
    `SELECT ${columns} FROM tenants t JOIN tenant_assistants a ON a.tenant_id = t.id
     WHERE a.assistant_id = $1`, [assistantId],
  );
  return rows[0] ? toTenant(rows[0]) : undefined;
}

export async function getTenant(id: string): Promise<Tenant | undefined> {
  const { rows } = await pool.query<TenantRow>(`SELECT ${columns} FROM tenants t WHERE t.id = $1`, [id]);
  return rows[0] ? toTenant(rows[0]) : undefined;
}

export async function listTenants(): Promise<Tenant[]> {
  const { rows } = await pool.query<TenantRow>(`SELECT ${columns} FROM tenants t ORDER BY t.id`);
  return rows.map(toTenant);
}

export type TenantPhoneNumber = { phoneNumberId: string; number: string | null };
export async function listTenantPhoneNumbers(): Promise<Map<string, TenantPhoneNumber[]>> {
  const { rows } = await pool.query<{ tenant_id: string; phone_number_id: string; number: string | null }>(
    "SELECT tenant_id, phone_number_id, number FROM tenant_phone_numbers ORDER BY tenant_id, phone_number_id",
  );
  const byTenant = new Map<string, TenantPhoneNumber[]>();
  for (const row of rows) {
    const list = byTenant.get(row.tenant_id) ?? [];
    list.push({ phoneNumberId: row.phone_number_id, number: row.number });
    byTenant.set(row.tenant_id, list);
  }
  return byTenant;
}
