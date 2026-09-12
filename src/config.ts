function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Env var ${name} must be a number, got ${raw}`);
  }
  return parsed;
}

function optionalBoolean(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true";
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  port: optionalNumber("PORT", 3002),
  vapiApiKey: process.env.VAPI_API_KEY ?? "",
  vapiBaseUrl: process.env.VAPI_BASE_URL ?? "https://api.vapi.ai",
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",

  /**
   * Off by default. This small safety net polls Vapi for calls whose terminal
   * webhook was missed; the gateway itself does not depend on it.
   */
  reconciliationEnabled: optionalBoolean("ENABLE_RECONCILIATION"),
  reconcileIntervalMs: optionalNumber("RECONCILE_INTERVAL_MS", 30_000),

  /**
   * DEMO ONLY. Mounts the presenter controls in src/routes/demo.ts, which let
   * anyone fill a tenant's lines and change its cap. Never set this on a
   * deployment that dials real numbers.
   */
  demoMode: optionalBoolean("DEMO_MODE"),

  /**
   * DEMO ONLY. Pacing for the cycle that moves a filled tenant between its cap
   * and one below it.
   *
   * The hold is deliberately the long half. Sitting at the cap is the state
   * worth talking about, and the opening is the payoff you place a real call
   * into, so a gap that comes around faster than you can narrate the limit
   * gets the demo backwards.
   */
  demo: {
    holdMs: optionalNumber("DEMO_HOLD_MS", 25_000),
    freeMs: optionalNumber("DEMO_FREE_MS", 12_000),
    tickMs: optionalNumber("DEMO_TICK_MS", 2_000),
  },
} as const;
