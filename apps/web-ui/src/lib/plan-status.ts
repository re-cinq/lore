/** How a plan's status reads on a card: its label and the pill colour. */
export interface PlanStatusBadge {
  label: string;
  color: string;
}

const BADGES: Record<string, PlanStatusBadge> = {
  draft: { label: "Draft", color: "var(--text-muted)" },
  "in-review": { label: "In review", color: "var(--warning)" },
  approved: { label: "Approved", color: "var(--success)" },
  superseded: { label: "Superseded", color: "var(--text-muted)" },
};

export function planStatusBadge(status: string): PlanStatusBadge {
  return BADGES[status] ?? { label: status, color: "var(--text-muted)" };
}
