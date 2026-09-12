import { DEFAULT_REJECT_MESSAGE } from "../tenants.js";
import { pool } from "./pool.js";

type SeedTenant = {
  id: string;
  displayName: string;
  cap: number;
  phoneNumberIds: string[];
  assistantIds?: string[];
  rejectMessage?: string;
  voiceId?: string;
};

function tenantsFromEnv(): SeedTenant[] {
  const raw = process.env.TENANTS_JSON;
  if (!raw) {
    throw new Error("Missing TENANTS_JSON. Copy the example from .env.example and replace it with your own Vapi ids.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("TENANTS_JSON must be valid JSON"); }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("TENANTS_JSON must be a non-empty array");
  }
  for (const tenant of parsed) {
    const value = tenant as Partial<SeedTenant>;
    if (typeof value.id !== "string" || typeof value.displayName !== "string" ||
      typeof value.cap !== "number" || !Number.isInteger(value.cap) || value.cap < 0 || !Array.isArray(value.phoneNumberIds) ||
      value.phoneNumberIds.some((id) => typeof id !== "string") ||
      (value.assistantIds !== undefined && (!Array.isArray(value.assistantIds) || value.assistantIds.some((id) => typeof id !== "string")))) {
      throw new Error("Each tenant needs id, displayName, non-negative integer cap, phoneNumberIds, and optional assistantIds");
    }
  }
  return parsed as SeedTenant[];
}

async function dialableNumber(phoneNumberId: string): Promise<string | null> {
  const key = process.env.VAPI_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch(`${process.env.VAPI_BASE_URL ?? "https://api.vapi.ai"}/phone-number/${phoneNumberId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!response.ok) return null;
    return ((await response.json()) as { number?: string }).number ?? null;
  } catch { return null; }
}

/** Inserts or updates the tenants declared in TENANTS_JSON. */
export async function seedTenants(): Promise<void> {
  const tenants = tenantsFromEnv();
  for (const tenant of tenants) {
    await pool.query(
      `INSERT INTO tenants (id, display_name, cap, reject_message, voice_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name,
         cap = excluded.cap, reject_message = excluded.reject_message,
         voice_id = excluded.voice_id, updated_at = now()`,
      [tenant.id, tenant.displayName, tenant.cap,
        tenant.rejectMessage ?? DEFAULT_REJECT_MESSAGE, tenant.voiceId ?? "Elliot"],
    );
    for (const assistantId of tenant.assistantIds ?? []) {
      await pool.query(`INSERT INTO tenant_assistants (assistant_id, tenant_id) VALUES ($1, $2)
        ON CONFLICT (assistant_id) DO UPDATE SET tenant_id = excluded.tenant_id`, [assistantId, tenant.id]);
    }
    for (const phoneNumberId of tenant.phoneNumberIds) {
      await pool.query(
        `INSERT INTO tenant_phone_numbers (phone_number_id, tenant_id, number) VALUES ($1, $2, $3)
         ON CONFLICT (phone_number_id) DO UPDATE SET tenant_id = excluded.tenant_id, number = excluded.number`,
        [phoneNumberId, tenant.id, await dialableNumber(phoneNumberId)],
      );
    }
  }
  console.log(`[isv-cap] seeded ${tenants.length} tenant${tenants.length === 1 ? "" : "s"}`);
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  seedTenants().then(() => pool.end()).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
