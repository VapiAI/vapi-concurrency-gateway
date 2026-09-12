import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCall, isTerminalStatus } from "../src/vapi.js";

const originalFetch = globalThis.fetch;

beforeEach(() => { process.env.VAPI_API_KEY = "test-key"; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

it("treats only ended as terminal", () => {
  expect(isTerminalStatus("ended")).toBe(true);
  expect(isTerminalStatus("forwarding")).toBe(false);
});

it("starts an outbound call and returns its id", async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "call_1" }), { status: 201 })) as typeof fetch;
  await expect(createCall({ assistantId: "asst_1", phoneNumberId: "pn_1", customerNumber: "+15551234567" }))
    .resolves.toEqual({ callId: "call_1" });
});

it("surfaces a rejected outbound call", async () => {
  globalThis.fetch = vi.fn(async () => new Response("bad destination", { status: 400 })) as typeof fetch;
  await expect(createCall({ assistantId: "asst_1", phoneNumberId: "pn_1", customerNumber: "+15551234567" }))
    .rejects.toThrow("Vapi POST /call failed (400)");
});
