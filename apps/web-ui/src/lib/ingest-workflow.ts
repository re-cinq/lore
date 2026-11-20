// Version markers only: onboarding writes the workflow itself now. Keep these in step with libs/shared/src/work/ingest-workflow.ts (held equal by ingest-workflow.parity.test.ts); web-ui does not depend on @re-cinq/lore-shared.

export const LORE_INGEST_WORKFLOW_PATH = ".github/workflows/lore-ingest.yml";

export const LORE_INGEST_WORKFLOW_VERSION = 10;

export type IngestWorkflowStatus = "missing" | "stale" | "aligned";

/** Read the `# lore-ingest-version: N` marker, or null when absent. */
export function parseIngestWorkflowVersion(content: string): number | null {
  const match = content.match(/^#\s*lore-ingest-version:\s*(\d+)/m);

  return match ? parseInt(match[1], 10) : null;
}

/** Classifies a repo's installed workflow against the canonical version; null content means absent, and a missing/older marker is `stale` (legacy installs predate the marker and carry the broken body). */
export function ingestWorkflowStatus(
  content: string | null,
): IngestWorkflowStatus {
  if (content === null) {
    return "missing";
  }
  const version = parseIngestWorkflowVersion(content);

  return version !== null && version >= LORE_INGEST_WORKFLOW_VERSION
    ? "aligned"
    : "stale";
}
