export type TenantStatus = "healthy" | "at-cap";

export type Slot = {
  reservationId: string;
  tenantId: string;
  state: "pending" | "reserved";
  callId: string | null;
  direction: "inbound" | "outbound";
  ageMs: number;
};

export type TenantState = {
  id: string;
  displayName: string;
  cap: number;
  used: number;
  phoneNumbers: Array<{ phoneNumberId: string; number: string | null }>;
  slots: Slot[];
};

export type StoredEvent = {
  id: string;
  at: string;
  kind: string;
  tenantId: string | null;
  callId: string | null;
  correlationId: string | null;
  detail: Record<string, unknown>;
};

export type DashboardState = {
  tenants: TenantState[];
  events: StoredEvent[];
  demoMode: boolean;
};
