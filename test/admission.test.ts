import { afterAll, beforeEach, expect, it } from "vitest";
import { release, reserve, usedForTenant } from "../src/admission.js";
import { pool } from "../src/db/pool.js";
import { closeDb, resetDb } from "./helpers/db.js";

const tenant = {
  id: "acme", displayName: "Acme", cap: 2, assistantId: null,
  rejectMessage: "Busy", voiceId: "Elliot",
};

beforeEach(async () => {
  await resetDb();
  await pool.query(
    `INSERT INTO tenants (id, display_name, cap, reject_message, voice_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenant.id, tenant.displayName, tenant.cap, tenant.rejectMessage, tenant.voiceId],
  );
});
afterAll(closeDb);

it("admits exactly the tenant cap under concurrent requests", async () => {
  const results = await Promise.all(
    ["call_1", "call_2", "call_3"].map((callId) => reserve({ tenant, callId, direction: "inbound" })),
  );
  expect(results.filter((result) => result.admitted)).toHaveLength(2);
  expect(await usedForTenant(tenant.id)).toBe(2);
});

it("releases a line when Vapi reports the call ended", async () => {
  await reserve({ tenant, callId: "call_1", direction: "inbound" });
  await release({ callId: "call_1", cause: "ended" });
  expect(await usedForTenant(tenant.id)).toBe(0);
});
