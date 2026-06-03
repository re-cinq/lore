import { describe, it, expect } from "vitest";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_VERSION,
  LORE_INGEST_WORKFLOW_CONTENT,
  ingestWorkflowStatus,
  parseIngestWorkflowVersion,
} from "../ingest-workflow.js";

describe("LORE_INGEST_WORKFLOW_CONTENT", () => {
  it("targets the workflows path", () => {
    expect(LORE_INGEST_WORKFLOW_PATH).toBe(".github/workflows/lore-ingest.yml");
  });

  it("carries the current version marker on the first line", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT.startsWith(`# lore-ingest-version: ${LORE_INGEST_WORKFLOW_VERSION}\n`)).toBe(true);
  });

  it("exposes FILES as a step-level env var, not inside the run block", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain("FILES: ${{ steps.changes.outputs.files }}");
  });

  it("sends a literal-escaped JSON body referencing the FILES env var", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain('\\"files\\": ${FILES}');
  });

  it("posts to the ingest endpoint without a self-referential url fallback", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain('"${LORE_INGEST_URL}/api/ingest"');
    expect(LORE_INGEST_WORKFLOW_CONTENT).not.toContain("LORE_INGEST_URL:-");
  });

  it("keeps the secret and token wiring", () => {
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain("LORE_INGEST_TOKEN: ${{ secrets.LORE_INGEST_TOKEN }}");
    expect(LORE_INGEST_WORKFLOW_CONTENT).toContain("LORE_INGEST_URL: ${{ vars.LORE_INGEST_URL }}");
  });
});

describe("parseIngestWorkflowVersion", () => {
  it("reads the version from the marker line", () => {
    expect(parseIngestWorkflowVersion("# lore-ingest-version: 7\nname: x")).toBe(7);
  });

  it("returns null when no marker is present", () => {
    expect(parseIngestWorkflowVersion("name: Lore Context Ingest\non: push")).toBeNull();
  });
});

describe("ingestWorkflowStatus", () => {
  it("returns missing when the file is absent", () => {
    expect(ingestWorkflowStatus(null)).toBe("missing");
  });

  it("returns stale when the file has no version marker (legacy broken install)", () => {
    expect(ingestWorkflowStatus("name: Lore Context Ingest\non: push")).toBe("stale");
  });

  it("returns stale when the marker version is older than current", () => {
    expect(ingestWorkflowStatus(`# lore-ingest-version: ${LORE_INGEST_WORKFLOW_VERSION - 1}\n`)).toBe("stale");
  });

  it("returns aligned for the canonical content", () => {
    expect(ingestWorkflowStatus(LORE_INGEST_WORKFLOW_CONTENT)).toBe("aligned");
  });

  it("returns aligned when the marker version is newer than current", () => {
    expect(ingestWorkflowStatus(`# lore-ingest-version: ${LORE_INGEST_WORKFLOW_VERSION + 1}\n`)).toBe("aligned");
  });
});
