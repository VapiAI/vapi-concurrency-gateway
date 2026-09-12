import type { DashboardState } from "./types";

export async function fetchState(): Promise<DashboardState> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error(`state request failed: ${response.status}`);
  return response.json() as Promise<DashboardState>;
}

async function write(path: string, body?: unknown, method = "POST") {
  await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * Presenter controls. These 404 unless the server runs with DEMO_MODE=true,
 * which is why the dashboard hides them behind the same flag.
 */
export const demo = {
  fill: (tenantId: string) => write(`/api/demo/tenants/${tenantId}/fill`),
  clear: (tenantId: string) => write(`/api/demo/tenants/${tenantId}/clear`),
  endCall: (callId: string) =>
    write(`/api/demo/calls/${encodeURIComponent(callId)}/end`),
  setCap: (tenantId: string, cap: number) =>
    write(`/api/demo/tenants/${tenantId}/cap`, { cap }, "PATCH"),
};
