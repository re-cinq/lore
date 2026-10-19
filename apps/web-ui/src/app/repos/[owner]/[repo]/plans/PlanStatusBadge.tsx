import { planStatusBadge } from "@/lib/plan-status";

export default function PlanStatusBadge({ status }: { status: string }) {
  const badge = planStatusBadge(status);

  return (
    <span
      role="status"
      aria-label={`Plan status: ${badge.label}`}
      className="status-pill"
      style={{ ["--pill-color" as string]: badge.color }}
    >
      {badge.label}
    </span>
  );
}
