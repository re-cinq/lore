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
  const at = visits.findLastIndex(isCreditFailure);

  if (at < 0) {
    return null;
  }
  const failed = visits[at];
  const recovered = visits
    .slice(at + 1)
    .some(
      ({ nodeId, report }) =>
        nodeId === failed.nodeId && report?.outcome === "success",
    );

  return recovered ? null : (failed.report?.error ?? null);
}

function isCreditFailure({ report }: ReportedVisit): boolean {
  return (
    report?.outcome === "failed" &&
    classifyError(report.error ?? "").category === "anthropic-credit"
  );
}
