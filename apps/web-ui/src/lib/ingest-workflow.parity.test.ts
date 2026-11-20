import { describe, it, expect } from "vitest";
import * as mirror from "./ingest-workflow";
import * as canonical from "../../../../libs/shared/src/work/ingest-workflow";

describe("ingest-workflow parity (web-ui version markers vs shared canonical)", () => {
  it("shares the workflow path and canonical version", () => {
    expect(mirror.LORE_INGEST_WORKFLOW_PATH).toBe(
      canonical.LORE_INGEST_WORKFLOW_PATH,
    );
    expect(mirror.LORE_INGEST_WORKFLOW_VERSION).toBe(
      canonical.LORE_INGEST_WORKFLOW_VERSION,
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
});
