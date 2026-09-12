import type { TenantStatus } from "../types";

/** One bar colour per status, so the hero reads at projector distance. */
const FILL: Record<TenantStatus, string> = {
  healthy: "bg-linear-to-r from-[hsl(154_89%_67%)] to-[hsl(170_90%_45%)]",
  "at-cap": "bg-[hsl(38_92%_48%)]",
};

export function Meter({
  used,
  cap,
  status,
}: {
  used: number;
  cap: number;
  status: TenantStatus;
}) {
  // A cap of 0 would divide by zero.
  const ratio = cap === 0 ? (used > 0 ? 1 : 0) : used / cap;
  const width = Math.min(100, ratio * 100);

  return (
    <div
      className="h-3 w-full overflow-hidden rounded-full bg-[hsl(45_30%_88%)]"
      role="meter"
      aria-valuenow={used}
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-label="lines in use"
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${FILL[status]}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
