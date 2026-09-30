import { describe, it, expect } from "vitest";
import type { Brief, Tools } from "@re-cinq/floor-station";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { postReviewHandle, type ReviewProject } from "./station.js";

const prUrl = "https://github.com/re-cinq/lore/pull/412";

const changesRequestedOutput = [
  "Looked at the diff.",
  "```REVIEW_FINDINGS",
  JSON.stringify({
    verdict: "changes_requested",
    findings: [
      { path: "src/a.ts", line: 12, label: "issue", subject: "null deref" },
      { path: "src/b.ts", line: 3, label: "nit", subject: "rename" },
    ],
  }),
  "```",
  "REVIEW_RESULT:CHANGES_REQUESTED:null deref",
].join("\n");

const brief = (needs: Record<string, string> = {}): Brief => ({
  visitId: "visit-9",
  iteration: 1,
  needs: { pr_url: prUrl, ...needs },
});

const toolsReading = (output: string): Tools => ({
  read: async () => Buffer.from(output),
  produce: async () => undefined,
  modelCall: async () => undefined,
  signal: new AbortController().signal,
});

function fakeProject(refusal?: string) {
  const reviews: CreateReviewInput[] = [];
  const comments: string[] = [];
  const checks: CheckRunInput[] = [];
  const repos: string[] = [];
  const project: ReviewProject = {
    pulls: {
      createReview: async (_number, input) => {
        enforceTrue(refusal === undefined, Error, refusal ?? "");
        reviews.push(input);
      },
      comment: async (_number, body) => {
        enforceTrue(refusal === undefined, Error, refusal ?? "");
        comments.push(body);
      },
      getDiff: async () => "",
      get: async () => ({ headSha: "livesha" }),
    },
    upsertCheckRun: async (input) => {
      checks.push(input);
    },
  };
  const deps = {
    project: async (repo: string) => {
      repos.push(repo);

      return project;
    },
  };

  return { deps, reviews, comments, checks, repos };
}

describe("postReviewHandle", () => {
  it("creates the review, upserts the neutral check and reports success with the summary and url", async () => {
    const { deps, reviews, checks } = fakeProject();

    const report = await postReviewHandle(deps)(
      brief({ head_sha: "abc123" }),
      toolsReading(changesRequestedOutput),
    );

    expect(report).toEqual({
      outcome: "success",
      produced: {
        review_summary: "Changes requested, 2 findings",
        review_url: prUrl,
      },
    });
    expect(reviews).toMatchObject([{ event: "REQUEST_CHANGES" }]);
    expect(checks).toMatchObject([
      {
        headSha: "abc123",
        name: "lore/code-review",
        status: "completed",
        conclusion: "neutral",
      },
    ]);
  });

  it("looks the head sha up on the pull request when the brief carries none", async () => {
    const { deps, checks } = fakeProject();

    await postReviewHandle(deps)(
      brief(),
      toolsReading("REVIEW_RESULT:APPROVED"),
    );

    expect(checks).toMatchObject([
      { headSha: "livesha", conclusion: "success" },
    ]);
  });

  it("opens the repository re-cinq/lore named by the pull request url", async () => {
    const { deps, repos } = fakeProject();

    await postReviewHandle(deps)(
      brief(),
      toolsReading("REVIEW_RESULT:APPROVED"),
    );

    expect(repos).toEqual(["re-cinq/lore"]);
  });

  it("reads the review out of an NDJSON result envelope", async () => {
    const { deps, reviews } = fakeProject();
    const envelope = JSON.stringify({
      type: "result",
      is_error: false,
      result: changesRequestedOutput,
    });

    await postReviewHandle(deps)(brief(), toolsReading(envelope));

    expect(reviews).toHaveLength(1);
  });

  it("throws when every review shape and the plain comment are refused", async () => {
    const { deps } = fakeProject("Forbidden");

    await expect(
      postReviewHandle(deps)(brief(), toolsReading(changesRequestedOutput)),
    ).rejects.toThrow(new Error("Forbidden"));
  });

  it("throws when the output has no verdict", async () => {
    const { deps } = fakeProject();

    await expect(
      postReviewHandle(deps)(brief(), toolsReading("the agent rambled")),
    ).rejects.toThrow(
      new Error(`no review verdict in the output for ${prUrl}`),
    );
  });

  it("throws when the pr_url is not a pull request", async () => {
    const { deps } = fakeProject();

    await expect(
      postReviewHandle(deps)(
        brief({ pr_url: "https://github.com/re-cinq/lore" }),
        toolsReading(changesRequestedOutput),
      ),
    ).rejects.toThrow(
      new Error(
        "not a GitHub pull request url: https://github.com/re-cinq/lore",
      ),
    );
  });
});
