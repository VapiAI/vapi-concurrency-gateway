import { Router } from "express";
import { config } from "../config.js";
import { findActiveSlots, type ActiveSlot } from "../admission.js";
import { listEvents, type StoredEvent } from "../events.js";
import { listTenantPhoneNumbers, listTenants, type TenantPhoneNumber } from "../tenants.js";

export type TenantState = {
  id: string;
  displayName: string;
  cap: number;
  used: number;
  phoneNumbers: TenantPhoneNumber[];
  slots: ActiveSlot[];
};

export type DashboardState = {
  tenants: TenantState[];
  events: StoredEvent[];
  /** Whether the presenter controls are mounted. Demo only. */
  demoMode: boolean;
};

export async function buildState(): Promise<DashboardState> {
  const [tenants, slots, events, phoneNumbers] = await Promise.all([
    listTenants(), findActiveSlots(), listEvents(100), listTenantPhoneNumbers(),
  ]);
  const byTenant = new Map<string, ActiveSlot[]>();
  for (const slot of slots) byTenant.set(slot.tenantId, [...(byTenant.get(slot.tenantId) ?? []), slot]);
  return {
    tenants: tenants.map((tenant) => {
      const tenantSlots = byTenant.get(tenant.id) ?? [];
      return { id: tenant.id, displayName: tenant.displayName, cap: tenant.cap,
        used: tenantSlots.length, phoneNumbers: phoneNumbers.get(tenant.id) ?? [], slots: tenantSlots };
    }),
    events,
    demoMode: config.demoMode,
  };
}

export function createStateRouter(): Router {
  const router = Router();
  router.get("/state", async (_req, res) => {
    try { res.status(200).json(await buildState()); }
    catch (error) {
      console.error("[state] build failed", error);
      res.status(500).json({ error: "Could not build state" });
    }
  });
  return router;
}
