import { describe, expect, it } from "vitest";
import { recordedPlanFloor } from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import {
  floorSpecTicketsHandlers,
  specMergeOf,
} from "./floor-spec-tickets-handlers.js";

const MERGED = {
  repo: "acme/widgets",
  pr_number: 7,
  merged: true,
  base_ref: "main",
  merge_commit_sha: "abc123",
};

describe("specMergeOf", () => {
  it("reads the merge out of a merged pull request's close", () => {
    expect(specMergeOf(MERGED)).toEqual({
      repo: "acme/widgets",
      prNumber: 7,
      merged: true,
      baseRef: "main",
      mergeCommitSha: "abc123",
    });
  });

  it("is null for a close that names no merge commit", () => {
    expect(specMergeOf({ ...MERGED, merge_commit_sha: undefined })).toBeNull();
  });
});

describe("floorSpecTicketsHandlers", () => {
  it("starts a spec-tickets run for a merged specs/<name>/spec.md on the default branch", async () => {
    const recorded = recordedPlanFloor();
    const handlers = floorSpecTicketsHandlers({
      tickets: () =>
        Promise.resolve({
          floor: recorded.floor,
          defaultBranch: () => Promise.resolve("main"),
          changedFiles: () => Promise.resolve(["specs/a/spec.md", "README.md"]),
          readSpec: () => Promise.resolve("| Status | In Progress |"),
          openRunKeys: () => Promise.resolve([]),
        }),
    });

    await handlers.get("github.pull_request.closed")?.(MERGED);

    expect(
      recorded.requests.filter(({ path }) => path.endsWith("/start")),
    ).toHaveLength(1);
  });
});
