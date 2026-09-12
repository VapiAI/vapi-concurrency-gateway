import { useEffect, useState } from "react";
import { demo } from "../api";
import type { TenantState } from "../types";
import { Meter } from "./Meter";

/**
 * Renders E.164 as a US number a presenter can read off a screen and dial.
 * Anything that is not a US eleven digit number is left exactly as given,
 * so an international line is never mangled into a wrong shape.
 */
function formatNumber(value: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : value;
}

function ageLabel(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

const SIMULATED = "sim_";
const GHOST =
  "rounded-lg border border-[hsl(45_35%_86%)] px-2.5 py-1 text-[12px] hover:bg-white/70";

export function TenantCard({
  tenant,
  demoMode,
  onChange,
}: {
  tenant: TenantState;
  demoMode: boolean;
  onChange: () => void;
}) {
  const atCap = tenant.used >= tenant.cap;
  const [capDraft, setCapDraft] = useState(String(tenant.cap));

  // Follow the server when the cap changes elsewhere, but never yank the field
  // out from under someone who is mid edit.
  useEffect(() => {
    setCapDraft((draft) =>
      draft === "" || Number(draft) === tenant.cap ? String(tenant.cap) : draft,
    );
  }, [tenant.cap]);

  async function act(run: () => Promise<void>) {
    await run();
    onChange();
  }

  return (
    <article className="vapi-glass min-w-0 p-5 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl">{tenant.displayName}</h2>
          <p className="mono mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
            {tenant.phoneNumbers
              .map((phone) =>
                phone.number
                  ? formatNumber(phone.number)
                  : phone.phoneNumberId.slice(0, 8),
              )
              .join(" · ")}
          </p>
        </div>
        <span className="vapi-chip rounded-full px-2.5 py-1 text-xs">
          {atCap ? "at cap" : "available"}
        </span>
      </header>

      <div className="mt-5">
        <p className="eyebrow">lines in use</p>
        <p className="mono mt-1 text-5xl leading-none tabular-nums">
          {tenant.used}
          <span className="text-2xl text-[hsl(var(--muted-foreground))]">
            {" "}
            / {tenant.cap}
          </span>
        </p>
      </div>
      <div className="mt-3">
        <Meter
          used={tenant.used}
          cap={tenant.cap}
          status={atCap ? "at-cap" : "healthy"}
        />
      </div>
      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
        {atCap
          ? "The next call for this tenant is rejected before it starts."
          : `${tenant.cap - tenant.used} lines available.`}
      </p>

      <details className="group mt-4 border-t border-[hsl(45_35%_86%)] pt-3">
        <summary className="eyebrow cursor-pointer select-none">
          <span className="pl-1">active calls ({tenant.slots.length})</span>
        </summary>
        <ul className="mt-2 space-y-1">
          {tenant.slots.length === 0 ? (
            <li className="text-sm text-[hsl(var(--muted-foreground))]">
              No active calls.
            </li>
          ) : null}
          {tenant.slots.map((slot) => (
            <li
              key={slot.reservationId}
              className="mono flex items-center justify-between gap-3 rounded-lg bg-white/60 px-2.5 py-1.5 text-[11px]"
            >
              <span className="min-w-0 flex-1 truncate">
                {slot.callId?.startsWith(SIMULATED)
                  ? "simulated call"
                  : (slot.callId ?? "starting outbound call")}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span>
                  {slot.direction} · {ageLabel(slot.ageMs)}
                </span>
                {demoMode && slot.callId?.startsWith(SIMULATED) ? (
                  <button
                    className="underline"
                    onClick={() =>
                      void act(() => demo.endCall(slot.callId as string))
                    }
                  >
                    end call
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {demoMode ? (
        <div className="mt-3 border-t border-[hsl(45_35%_86%)] pt-3">
          <p className="eyebrow">demo controls</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className={GHOST}
              onClick={() => void act(() => demo.fill(tenant.id))}
            >
              fill lines
            </button>
            <button
              className={GHOST}
              onClick={() => void act(() => demo.clear(tenant.id))}
            >
              clear
            </button>
            <span className="flex items-center gap-1.5">
              <label className="eyebrow" htmlFor={`cap-${tenant.id}`}>
                cap
              </label>
              <input
                id={`cap-${tenant.id}`}
                className="mono w-14 rounded-lg border border-[hsl(45_35%_86%)] px-2 py-1 text-[12px]"
                inputMode="numeric"
                value={capDraft}
                onChange={(event) =>
                  setCapDraft(event.target.value.replace(/\D/g, ""))
                }
              />
              <button
                className={GHOST}
                disabled={capDraft === "" || Number(capDraft) === tenant.cap}
                onClick={() =>
                  void act(() => demo.setCap(tenant.id, Number(capDraft)))
                }
              >
                apply
              </button>
            </span>
          </div>
        </div>
      ) : null}
    </article>
  );
}
