import { describe, it, expect } from "vitest";
import { commitItems } from "./commit-statements.js";
import { attribute, fitsOneItem, relation } from "./statements.js";

const SHA = "7b89df02405fcc32f6621ec030f417fea0265694";
const PARENT = "c36ee3e92ea3ad481b85612e36172c13af3bdea7";
const REPO = "re-cinq/lore";
const COMMIT = `${REPO}/commit/${SHA}`;
const PARENT_COMMIT = `${REPO}/commit/${PARENT}`;
const AUTHORED = "2026-10-16T08:12:00Z";

const build = (overrides: Partial<Parameters<typeof commitItems>[1]> = {}) =>
  commitItems(REPO, {
    sha: SHA,
    parents: [PARENT],
    subject: "Utopia: give its database a full CPU, two to burst (#2773)",
    body: "",
    author: "Szabo Bogdan",
    authoredAt: AUTHORED,
    files: [
      { path: "infra/terraform/utopia.tf", kind: "code" },
      { path: "specs/utopia-graph-mirror/spec.md", kind: "spec" },
    ],
    ...overrides,
  });

const commitHead = [
  relation(REPO, "contains", COMMIT),
  attribute(COMMIT, "sha", SHA),
  attribute(
    COMMIT,
    "title",
    "Utopia: give its database a full CPU, two to burst (#2773)",
  ),
  attribute(COMMIT, "author", "Szabo Bogdan"),
  attribute(COMMIT, "authored_at", AUTHORED),
  attribute(COMMIT, "permalink", `https://github.com/${COMMIT}`),
  relation(COMMIT, "follows", PARENT_COMMIT),
];

const pullRequest = [
  relation(COMMIT, "merges", `${REPO}/pull/2773`),
  relation(REPO, "contains", `${REPO}/pull/2773`),
  attribute(`${REPO}/pull/2773`, "number", "2773"),
  attribute(
    `${REPO}/pull/2773`,
    "permalink",
    `https://github.com/${REPO}/pull/2773`,
  ),
];

const changes = [
  relation(COMMIT, "changes", `${REPO}:infra/terraform/utopia.tf`),
  attribute(
    `${REPO}:infra/terraform/utopia.tf`,
    "path",
    "infra/terraform/utopia.tf",
  ),
  relation(COMMIT, "changes", `${REPO}:specs/utopia-graph-mirror/spec.md`),
  attribute(
    `${REPO}:specs/utopia-graph-mirror/spec.md`,
    "path",
    "specs/utopia-graph-mirror/spec.md",
  ),
];

describe("commitItems", () => {
  it("returns one commit:<sha> item at the author date where the commit follows its parent, merges pull request 2773 and changes a SourceFile and a Spec named as the doc and code mirrors name them", () => {
    expect(build()).toEqual([
      {
        externalId: `commit:${SHA}`,
        doc_time: AUTHORED,
        e: [
          [REPO, "Repository", true],
          [COMMIT, "Commit", true],
          [PARENT_COMMIT, "Commit", true],
          [`${REPO}/pull/2773`, "PullRequest", true],
          [`${REPO}:infra/terraform/utopia.tf`, "SourceFile", true],
          [`${REPO}:specs/utopia-graph-mirror/spec.md`, "Spec", true],
        ],
        s: [...commitHead, ...pullRequest, ...changes],
      },
    ]);
  });

  it("links the pull request to issues 12 and 7 it closes or refers to and to the Lore task its body names, and carries the body as text with its whitespace collapsed", () => {
    const [commitItem] = build({
      body: "Gives the pod a full CPU.\n\nCloses #12\nRefs  #7\nLore-Task: 6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c",
    });
    const task = `${REPO}/tasks/6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c`;

    expect({ e: commitItem.e, s: commitItem.s }).toEqual({
      e: [
        [REPO, "Repository", true],
        [COMMIT, "Commit", true],
        [PARENT_COMMIT, "Commit", true],
        [`${REPO}/pull/2773`, "PullRequest", true],
        [`${REPO}/issues/12`, "Issue", true],
        [`${REPO}/issues/7`, "Issue", true],
        [task, "Task", true],
        [`${REPO}:infra/terraform/utopia.tf`, "SourceFile", true],
        [`${REPO}:specs/utopia-graph-mirror/spec.md`, "Spec", true],
      ],
      s: [
        ...commitHead.slice(0, 3),
        attribute(
          COMMIT,
          "text",
          "Gives the pod a full CPU. Closes #12 Refs #7 Lore-Task: 6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c",
        ),
        ...commitHead.slice(3),
        ...pullRequest,
        relation(`${REPO}/pull/2773`, "closes", `${REPO}/issues/12`),
        relation(REPO, "contains", `${REPO}/issues/12`),
        attribute(`${REPO}/issues/12`, "number", "12"),
        attribute(
          `${REPO}/issues/12`,
          "permalink",
          `https://github.com/${REPO}/issues/12`,
        ),
        relation(`${REPO}/pull/2773`, "closes", `${REPO}/issues/7`),
        relation(REPO, "contains", `${REPO}/issues/7`),
        attribute(`${REPO}/issues/7`, "number", "7"),
        attribute(
          `${REPO}/issues/7`,
          "permalink",
          `https://github.com/${REPO}/issues/7`,
        ),
        relation(`${REPO}/pull/2773`, "delivers", task),
        relation(REPO, "contains", task),
        attribute(task, "task_id", "6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c"),
        ...changes,
      ],
    });
  });

  it("names no pull request, issue or task for a commit pushed without one, even when its body says Closes #3", () => {
    const [commitItem] = build({
      subject: "Fix the parser",
      body: "Closes #3\nLore-Task: 6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c",
      parents: [],
    });

    expect({
      kinds: commitItem.e.map((entity) => entity[1]),
      phrases: commitItem.s.map((row) => row[2]),
    }).toEqual({
      kinds: ["Repository", "Commit", "SourceFile", "Spec"],
      phrases: [
        "contains",
        "sha",
        "title",
        "text",
        "author",
        "authored_at",
        "permalink",
        "changes",
        "path",
        "changes",
        "path",
      ],
    });
  });

  it("cuts a 5,003-character body to its first 4,000 characters and an ellipsis", () => {
    const [commitItem] = build({ body: "x".repeat(5003) });
    const text = commitItem.s.find((row) => row[2] === "text")?.[4];

    expect({ length: text?.length, end: text?.slice(-2) }).toEqual({
      length: 4001,
      end: "x…",
    });
  });

  it("splits a commit touching 500 files, two statements each, into eight items under 200 statements, the first keeping commit:<sha> and every part repeating the commit head and its pull request", () => {
    const files = Array.from({ length: 500 }, (_, i) => ({
      path: `src/f${i}.ts`,
      kind: "code" as const,
    }));
    const parts = build({ files });

    expect({
      ids: parts.map((part) => part.externalId),
      fits: parts.every(fitsOneItem),
      heads: parts.map((part) =>
        part.s.slice(0, commitHead.length + pullRequest.length),
      ),
      changed: parts.flatMap((part) =>
        part.s.filter((row) => row[2] === "changes"),
      ).length,
      docTimes: parts.map((part) => part.doc_time),
    }).toEqual({
      ids: [
        `commit:${SHA}`,
        ...[2, 3, 4, 5, 6, 7, 8].map((part) => `commit:${SHA}.${part}`),
      ],
      fits: true,
      heads: parts.map(() => [...commitHead, ...pullRequest]),
      changed: 500,
      docTimes: parts.map(() => AUTHORED),
    });
  });
});
