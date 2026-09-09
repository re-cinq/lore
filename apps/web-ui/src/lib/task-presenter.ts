// Pure presentation helpers; no DB/React so formatting rules stay unit-testable.

const ELLIPSIS = "…";
const EM_DASH = "—";

/** Formats USD cost for table cell: $0 (zero/non-finite), <$0.01 (sub-cent), or two decimals. */
export function formatCost(usd: number | null | undefined): string {
  const value = typeof usd === "number" && Number.isFinite(usd) ? usd : 0;

  if (value <= 0) {
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
