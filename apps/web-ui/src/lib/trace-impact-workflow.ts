// Version markers only: onboarding writes the workflow itself now. Keep these in step with libs/shared/src/work/trace-impact-workflow.ts (held equal by trace-impact-workflow.parity.test.ts); web-ui does not depend on @re-cinq/lore-shared.

export const TRACE_IMPACT_WORKFLOW_PATH =
  ".github/workflows/lore-trace-impact.yml";

export const TRACE_IMPACT_WORKFLOW_VERSION = 2;

export type TraceImpactWorkflowStatus = "missing" | "stale" | "aligned";

/** Read the `# lore-trace-impact-version: N` marker, or null when absent. */
export function parseTraceImpactWorkflowVersion(
  content: string,
): number | null {
  const match = content.match(/^#\s*lore-trace-impact-version:\s*(\d+)/m);

  return match ? parseInt(match[1], 10) : null;
}

/** Classify a repo's installed workflow against the canonical version. */
export function traceImpactWorkflowStatus(
  content: string | null,
): TraceImpactWorkflowStatus {
  if (content === null) {
    return "missing";
  }
  const version = parseTraceImpactWorkflowVersion(content);

  return version !== null && version >= TRACE_IMPACT_WORKFLOW_VERSION
    ? "aligned"
    : "stale";
}
