import { classifyError } from "../../lib/error-classify.js";

/** A station visit as far as its report goes; agent pods and stations that call a model in-process report alike. */
export interface ReportedVisit {
  nodeId: string;
  report?: { outcome?: string | null; error?: string | null } | null;
}

/** The error of the last failed visit that ran out of model credit, or null when none did or its station later succeeded (the credit came back). How the run ended says nothing: a line may route the failure on to a station that ends it green. */
export function creditFailureOf(
  visits: readonly ReportedVisit[],
): string | null {
  return creditFailedVisitOf(visits)?.error ?? null;
}

/** The station that ran out of credit and its error, by the same rule as `creditFailureOf`: what resuming the loop runs again. */
export function creditFailedVisitOf(
  visits: readonly ReportedVisit[],
): { nodeId: string; error: string } | null {
  const at = visits.findLastIndex(isCreditFailure);

  if (at < 0) {
    return null;
  }
  const { nodeId, report } = visits[at];
  const recovered = visits
    .slice(at + 1)
    .some(
      (later) => later.nodeId === nodeId && later.report?.outcome === "success",
    );

  return recovered ? null : { nodeId, error: report?.error ?? "" };
}

function isCreditFailure({ report }: ReportedVisit): boolean {
  return (
    report?.outcome === "failed" &&
    classifyError(report.error ?? "").category === "anthropic-credit"
  );
}
