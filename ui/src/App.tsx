import { useCallback, useEffect, useState } from "react";
import { fetchState } from "./api";
import { TenantCard } from "./components/TenantCard";
import type { DashboardState } from "./types";

/**
 * The two words the room needs are accepted and rejected, so those lead and
 * carry the colour. Everything else is bookkeeping and stays grey rather than
 * competing with them.
 */
const EVENT_LABELS: Record<string, { text: string; className: string }> = {
  admit: {
    text: "accepted",
    className: "bg-[hsl(150_55%_90%)] text-[hsl(150_60%_25%)]",
  },
  reject: {
    text: "rejected",
    className: "bg-[hsl(0_75%_93%)] text-[hsl(0_65%_38%)]",
  },
  release: { text: "ended", className: "bg-black/5 text-black/55" },
  "reconcile-release": { text: "ended", className: "bg-black/5 text-black/55" },
  adopt: { text: "dialed", className: "bg-black/5 text-black/55" },
  "cap-change": { text: "cap", className: "bg-black/5 text-black/55" },
};

const FALLBACK_LABEL = { text: "event", className: "bg-black/5 text-black/55" };

export default function App() {
  // Everything logged before the page opened belongs to an earlier run. A
  // presenter opening this wants to see what happens next, not a backlog of
  // rehearsals, so the log starts from here.
  const [openedAt] = useState(() => Date.now());
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setState(await fetchState());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const freshEvents = (state?.events ?? []).filter(
    (event) => new Date(event.at).getTime() >= openedAt,
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-3xl sm:text-4xl">
          <span className="vapi-text-gradient">Line Allocator</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm text-[hsl(var(--muted-foreground))]">
          Each client has its own concurrency cap. Calls above that cap never
          start.
        </p>
      </header>
      {error ? (
        <p className="mt-4 rounded-lg bg-[hsl(0_80%_94%)] px-3 py-2 text-sm text-[hsl(0_72%_35%)]">
          Could not reach the gateway: {error}
        </p>
      ) : null}
      {state ? (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {state.tenants.map((tenant) => (
              <TenantCard
                key={tenant.id}
                tenant={tenant}
                demoMode={state.demoMode}
                onChange={() => void refresh()}
              />
            ))}
          </div>
          <section className="vapi-glass mt-5 p-5">
            <details open>
              <summary className="eyebrow cursor-pointer select-none">
                <span className="pl-1">
                  recent activity ({freshEvents.length})
                </span>
              </summary>
              <ul className="mt-3 space-y-1 text-sm">
                {freshEvents.slice(0, 20).map((event) => {
                  const label = EVENT_LABELS[event.kind] ?? FALLBACK_LABEL;
                  return (
                    <li key={event.id} className="flex items-center gap-2.5">
                      <span
                        className={`mono w-[68px] shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10px] uppercase ${label.className}`}
                      >
                        {label.text}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {event.tenantId ?? "gateway"}
                      </span>
                      <span className="mono shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">
                        {new Date(event.at).toLocaleTimeString()}
                      </span>
                    </li>
                  );
                })}
                {freshEvents.length === 0 ? (
                  <li className="text-[hsl(var(--muted-foreground))]">
                    Nothing yet. Call a number, or fill a tenant's lines.
                  </li>
                ) : null}
              </ul>
            </details>
          </section>
        </>
      ) : (
        <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
          Loading.
        </p>
      )}
    </main>
  );
}
