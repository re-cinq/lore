import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  AUTO_MERGE_SUBJECT,
  autoMergeStartItems,
  floorRepoOf,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { oneOpenRunPerSubject } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import {
  startReview,
  type ReviewStartDeps,
} from "@re-cinq/lore-shared/review/floor-review-start.js";

interface Line {
  id: string;
  args: Record<string, { subject?: boolean }>;
}

const FOLDER = new URL("./", import.meta.url);
const LINES = readdirSync(FOLDER)
  .filter((file) => file.endsWith(".yaml"))
  .map(
    (file) =>
      (parse(readFileSync(new URL(file, FOLDER), "utf8")) as { line: Line })
        .line,
  );

const PULL = {
  repo: "re-cinq/lore",
  number: 412,
  title: "Fix the login",
  branch: "fix/login",
  state: "open" as const,
  labels: [],
  url: "https://github.com/re-cinq/lore/pull/412",
  draft: false,
  headSha: "sha-new",
};

describe("the subjects the floor keys open runs on", () => {
  it("leaves pr_url to code-review alone, since the floor holds one open run per repository and subject on any line", () => {
    expect(
      LINES.filter((line) => subjectOf(line.id) === "pr_url").map(
        (line) => line.id,
      ),
    ).toEqual(["code-review"]);
  });

  it("keys auto-merge on the subject its start items carry, and gives every argument the line declares", () => {
    expect({
      subject: subjectOf("auto-merge"),
      given: Object.keys(autoMergeStartItems(PULL.repo, PULL)).sort(),
    }).toEqual({
      subject: AUTO_MERGE_SUBJECT,
      given: Object.keys(lineOf("auto-merge").args).sort(),
    });
  });

  it("starts and announces a forced review of pull request 412 while its auto-merge run waits", async () => {
    const { floor, requests } = oneOpenRunPerSubject(subjectOf);
    const comments: string[] = [];

    const waiting = await floor.lines.start("auto-merge", {
      repo: floorRepoOf(PULL.repo),
      startItems: autoMergeStartItems(PULL.repo, PULL),
    });
    const started = await startReview(depsOn(floor, comments), {
      repo: PULL.repo,
      prNumber: PULL.number,
      autoReview: true,
      forced: true,
    });

    expect({
      waiting: waiting.joined,
      started,
      starts: requests.filter(({ path }) => path.endsWith("/start")).length,
      announced: comments.filter((body) =>
        body.startsWith("Lore is reviewing this PR — run-on-code-review"),
      ).length,
    }).toEqual({
      waiting: false,
      started: "run-on-code-review",
      starts: 2,
      announced: 1,
    });
  });
});

function lineOf(id: string): Line {
  const line = LINES.find((candidate) => candidate.id === id);

  enforceTrue(line !== undefined, Error, `no floor line ${id}`);

  return line;
}

function subjectOf(id: string): string {
  const [subject] = Object.entries(lineOf(id).args)
    .filter(([, arg]) => arg.subject)
    .map(([name]) => name);

  return subject;
}

function depsOn(
  floor: ReviewStartDeps["floor"],
  comments: string[],
): ReviewStartDeps {
  return {
    floor,
    pulls: {
      get: () => Promise.resolve(PULL),
      comment: (_number, body) => {
        comments.push(body);

        return Promise.resolve();
      },
      listCommits: () => Promise.resolve([]),
      listReviews: () => Promise.resolve([]),
      listComments: () => Promise.resolve([]),
      listReviewThreads: () => Promise.resolve([]),
      listChecks: () => Promise.resolve([]),
      netChange: () => Promise.resolve(null),
    },
    issues: { get: () => Promise.resolve(null) },
    checks: { upsertCheckRun: () => Promise.resolve() },
  };
}
