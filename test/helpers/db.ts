import { pool } from "../../src/db/pool.js";
import { migrate } from "../../src/db/migrate.js";

let migrated = false;

/**
 * Applies the schema once per process, then truncates every table so each test
 * starts from a known empty state. Truncation is faster and less fragile than
 * dropping and recreating the schema between tests.
 */
export async function resetDb(): Promise<void> {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
  await pool.query(
    "TRUNCATE reservations, events, tenant_phone_numbers, tenant_assistants, tenants RESTART IDENTITY CASCADE",
  );
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
