import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { LORE_INGEST_WORKFLOW_CONTENT } from "./ingest-workflow.js";

const workflow = parse(LORE_INGEST_WORKFLOW_CONTENT) as {
  concurrency?: unknown;
  jobs: Record<string, { concurrency?: unknown }>;
};

describe("the ingest workflow's graph job", () => {
  it("runs one at a time in the group lore-graph-projection, never cancelling the run in progress", () => {
    expect(workflow.jobs.graph.concurrency).toEqual({
      group: "lore-graph-projection",
      "cancel-in-progress": false,
    });
  });

  it("leaves the ingest job out of the group, so a replaced queued run still posts its changed files", () => {
    expect({
      workflow: workflow.concurrency,
      ingest: workflow.jobs.ingest.concurrency,
    }).toEqual({ workflow: undefined, ingest: undefined });
  });

  it("is what this repository's own lore-ingest.yml runs", () => {
    expect(
      readFileSync(
        new URL(
          "../../../../.github/workflows/lore-ingest.yml",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toBe(LORE_INGEST_WORKFLOW_CONTENT);
  });
});
