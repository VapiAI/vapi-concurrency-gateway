import { config } from "./config.js";

export type VapiCallStatus = "scheduled" | "queued" | "ringing" | "in-progress" | "forwarding" | "ended";

export function isTerminalStatus(status: string | undefined): boolean {
  return status === "ended";
}

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.VAPI_API_KEY ?? config.vapiApiKey}`,
    "content-type": "application/json",
  };
}

function url(path: string): string {
  return `${process.env.VAPI_BASE_URL ?? config.vapiBaseUrl}${path}`;
}

/** Starts an outbound call and returns the Vapi call id. */
export async function createCall(input: {
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
}): Promise<{ callId: string }> {
  const response = await fetch(url("/call"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      type: "outboundPhoneCall",
      assistantId: input.assistantId,
      phoneNumberId: input.phoneNumberId,
      customer: { number: input.customerNumber },
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Vapi POST /call failed (${response.status}): ${body.slice(0, 300)}`);
  }
  const parsed = JSON.parse(body) as { id?: string };
  if (!parsed.id) throw new Error("Vapi POST /call returned no call id");
  return { callId: parsed.id };
}

export type ReadCallOutcome =
  | { kind: "read"; status: VapiCallStatus; endedReason?: string }
  | { kind: "unavailable" };

/** Used only by the opt-in reconciler. The normal release path is the webhook. */
export async function readCall(callId: string): Promise<ReadCallOutcome> {
  try {
    const response = await fetch(url(`/call/${encodeURIComponent(callId)}`), { headers: headers() });
    if (!response.ok) return { kind: "unavailable" };
    const parsed = await response.json() as { status?: VapiCallStatus; endedReason?: string };
    if (!parsed.status) return { kind: "unavailable" };
    return { kind: "read", status: parsed.status, ...(parsed.endedReason ? { endedReason: parsed.endedReason } : {}) };
  } catch {
    return { kind: "unavailable" };
  }
}
