import { classifyError } from "../../lib/error-classify.js";

/** A station visit as far as its report goes; agent pods and stations that call a model in-process report alike. */
export interface ReportedVisit {
  report?: { outcome?: string | null; error?: string | null } | null;
}

/** The error of the last failed visit that ran out of model credit, or null when no visit did. */
export function creditFailureOf(
  visits: readonly ReportedVisit[],
): string | null {
  const failure = visits.findLast(
    ({ report }) =>
      report?.outcome === "failed" &&
      Boolean(report.error) &&
      classifyError(report.error ?? "").category === "anthropic-credit",
  );

  return failure?.report?.error ?? null;
}
