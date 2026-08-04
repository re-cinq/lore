import { describe, it, expect } from "vitest";
// web-ui can't import the @re-cinq/lore-shared PACKAGE (workspace + Docker
// isolation), so the canonical lore-ingest.yml workflow is hand-duplicated.
// This CI-only test (runs in a full checkout) imports shared's PURE
// ingest-workflow.ts by file path — never the package — to keep the mirror in
// lockstep. The byte content matters: the web-ui "fix" button commits the
// mirror's constant to repos, while the agent's onboard handler commits the
// shared one — a silent divergence ships two different workflows.
import * as mirror from "./ingest-workflow";
import * as canonical from "../../../../libs/shared/src/ingest-workflow";

describe("ingest-workflow parity (web-ui mirror vs shared canonical)", () => {
  it("shares the workflow path and canonical version", () => {
    expect(mirror.LORE_INGEST_WORKFLOW_PATH).toBe(
      canonical.LORE_INGEST_WORKFLOW_PATH,
    );
    expect(mirror.LORE_INGEST_WORKFLOW_VERSION).toBe(
      canonical.LORE_INGEST_WORKFLOW_VERSION,
    );
  });

  it("shares the workflow content byte for byte", () => {
    expect(mirror.LORE_INGEST_WORKFLOW_CONTENT).toBe(
      canonical.LORE_INGEST_WORKFLOW_CONTENT,
    );
  });

  it.each([
    null,
    "",
    "no marker at all",
    "# lore-ingest v1\nold",
    "# lore-ingest v99\nnewer",
  ])("classifies installed content %j identically", (content) => {
    expect(mirror.ingestWorkflowStatus(content)).toEqual(
      canonical.ingestWorkflowStatus(content),
    );
    expect(mirror.parseIngestWorkflowVersion(content ?? "")).toEqual(
      canonical.parseIngestWorkflowVersion(content ?? ""),
    );
  });

  it("classifies the canonical content as aligned on both sides", () => {
    expect(
      mirror.ingestWorkflowStatus(canonical.LORE_INGEST_WORKFLOW_CONTENT),
    ).toBe("aligned");
    expect(
      canonical.ingestWorkflowStatus(mirror.LORE_INGEST_WORKFLOW_CONTENT),
    ).toBe("aligned");
  });
});
