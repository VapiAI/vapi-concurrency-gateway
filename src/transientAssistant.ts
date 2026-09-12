import type { Tenant } from "./tenants.js";

/** Builds the assistant returned when an inbound call is admitted. */
export function buildTransientAdmission(tenant: Tenant) {
  return {
    assistant: {
      name: `${tenant.displayName} reception`,
      firstMessage: `Thanks for calling ${tenant.displayName}, how can I help?`,
      model: {
        provider: "openai",
        model: "gpt-4.1",
        messages: [{
          role: "system",
          content: `You are the receptionist for ${tenant.displayName}. Keep every reply to one short sentence. If the caller asks something you cannot answer, say someone will call them back.`,
        }],
      },
      voice: { provider: "vapi", voiceId: tenant.voiceId },
      transcriber: { provider: "deepgram", model: "nova-3" },
    },
  };
}
