import { describe, it, expect } from "vitest";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_VERSION,
  LORE_INGEST_WORKFLOW_CONTENT,
  parseIngestWorkflowVersion,
  ingestWorkflowStatus,
} from "./ingest-workflow";

describe("constants", () => {
  it("pins the workflow path to .github/workflows/lore-ingest.yml", () => {
    expect(LORE_INGEST_WORKFLOW_PATH).toBe(".github/workflows/lore-ingest.yml");
  });

  it("pins the canonical version to 2", () => {
    expect(LORE_INGEST_WORKFLOW_VERSION).toBe(2);
  });

  it("embeds a version marker that matches the version constant", () => {
    expect(parseIngestWorkflowVersion(LORE_INGEST_WORKFLOW_CONTENT)).toBe(
      LORE_INGEST_WORKFLOW_VERSION,
    );
  });

  it("classifies its own canonical content as aligned", () => {
    expect(ingestWorkflowStatus(LORE_INGEST_WORKFLOW_CONTENT)).toBe("aligned");
  });
});

describe("parseIngestWorkflowVersion", () => {
  it("reads the version from a leading marker line", () => {
    expect(parseIngestWorkflowVersion("# lore-ingest-version: 2\nname: x")).toBe(2);
  });

  it("returns null when no marker is present", () => {
    expect(parseIngestWorkflowVersion("name: Lore Context Ingest\non: push")).toBe(null);
  });

  it("returns null for empty content", () => {
    expect(parseIngestWorkflowVersion("")).toBe(null);
  });

  it("matches a marker on a non-first line via the multiline flag", () => {
    expect(parseIngestWorkflowVersion("name: x\n# lore-ingest-version: 5\nmore")).toBe(5);
  });

  it("tolerates no space after the hash", () => {
    expect(parseIngestWorkflowVersion("#lore-ingest-version: 3")).toBe(3);
  });

  it("tolerates extra spaces around the hash and colon", () => {
    expect(parseIngestWorkflowVersion("#   lore-ingest-version:   7")).toBe(7);
  });

  it("parses a multi-digit version", () => {
    expect(parseIngestWorkflowVersion("# lore-ingest-version: 42")).toBe(42);
  });

  it("returns 0 for a zero version marker (parseInt, not truthiness)", () => {
    expect(parseIngestWorkflowVersion("# lore-ingest-version: 0")).toBe(0);
  });

  it("does not match a marker that is not anchored at line start", () => {
    expect(parseIngestWorkflowVersion("  # lore-ingest-version: 2")).toBe(null);
  });

  it("does not match when the digits are missing after the colon", () => {
    expect(parseIngestWorkflowVersion("# lore-ingest-version: ")).toBe(null);
  });

  it("stops at the first non-digit so a trailing suffix is ignored", () => {
    expect(parseIngestWorkflowVersion("# lore-ingest-version: 2x")).toBe(2);
  });
});

describe("ingestWorkflowStatus", () => {
  it("returns missing when content is null", () => {
    expect(ingestWorkflowStatus(null)).toBe("missing");
  });

  it("returns stale when the marker is absent", () => {
    expect(ingestWorkflowStatus("name: Lore Context Ingest")).toBe("stale");
  });

  it("returns stale for an empty string (no marker)", () => {
    expect(ingestWorkflowStatus("")).toBe("stale");
  });

  it("returns stale when the version is below the canonical version", () => {
    expect(ingestWorkflowStatus("# lore-ingest-version: 1\nname: x")).toBe("stale");
  });

  it("returns stale at the zero boundary below the canonical version", () => {
    expect(ingestWorkflowStatus("# lore-ingest-version: 0")).toBe("stale");
  });

  it("returns aligned exactly at the canonical version boundary", () => {
    expect(ingestWorkflowStatus(`# lore-ingest-version: ${LORE_INGEST_WORKFLOW_VERSION}`)).toBe(
      "aligned",
    );
  });

  it("returns aligned when the version is above the canonical version", () => {
    expect(ingestWorkflowStatus("# lore-ingest-version: 99\nname: x")).toBe("aligned");
  });
});
