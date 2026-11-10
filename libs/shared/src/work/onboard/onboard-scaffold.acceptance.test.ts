import { describe, expect, it } from "vitest";
import { commitOnboardScaffold } from "./onboard-scaffold.js";
import { LORE_INGEST_WORKFLOW_PATH } from "../ingest-workflow.js";
import {
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_CONTENT,
} from "../trace-impact-workflow.js";

describe("commitOnboardScaffold", () => {
  it("commits a Lore-owned file when the branch's copy differs from the canonical content", async () => {
    const commits: string[] = [];
    const repo = {
      read: (path: string) => {
        if (path === LORE_INGEST_WORKFLOW_PATH) {
          return Promise.resolve("drifted content");
        }

        if (path === TRACE_IMPACT_WORKFLOW_PATH) {
          return Promise.resolve(TRACE_IMPACT_WORKFLOW_CONTENT);
        }

        return Promise.resolve("some current content");
      },
      commitFile: (branch: string, path: string) => {
        commits.push(path);

        return Promise.resolve();
      },
    };

    const result = await commitOnboardScaffold(repo, "main");

    expect(commits).toContain(LORE_INGEST_WORKFLOW_PATH);
    expect(commits).not.toContain(TRACE_IMPACT_WORKFLOW_PATH);
    expect(result.failures).toEqual([]);
  });
});
