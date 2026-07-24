// Pure presentation helpers for the agents and tasks tables. No DB or React
// here so the formatting rules stay unit-testable in isolation.

const ELLIPSIS = "…";
const EM_DASH = "—";

/** Format a USD cost for a table cell: `$0` for a zero/non-finite cost, `<$0.01`
 *  for a sub-cent amount, two decimals otherwise. */
export function formatCost(usd: number | null | undefined): string {
  const value = typeof usd === "number" && Number.isFinite(usd) ? usd : 0;

  if (value === 0) {
    return "$0";
  }

  if (value < 0.01) {
    return "<$0.01";
  }

  return `$${value.toFixed(2)}`;
}

/** Shorten an agent id to `len` chars, appending an ellipsis when clipped. */
export function shortAgentId(id: string | null | undefined, len = 12): string {
  if (!id) {
    return EM_DASH;
  }

  return id.length > len ? id.slice(0, len) + ELLIPSIS : id;
}

/** Clip free text to `max` chars, appending an ellipsis when clipped. */
export function truncate(text: string | null | undefined, max: number): string {
  if (!text) {
    return EM_DASH;
  }

  return text.length > max ? text.slice(0, max) + ELLIPSIS : text;
}

/** Render the task/agent creator, falling back to "unknown" when absent. */
export function displayCreatedBy(value: string | null | undefined): string {
  return value ? value : "unknown";
}
