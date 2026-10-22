import { describe, it, expect } from "vitest";
import { trackerItems, type TrackedEntry } from "./tracker-statements.js";
import { attribute, fitsOneItem, relation } from "../statements.js";

const REPO = "re-cinq/lore";
const PULL = `${REPO}/pull/2790`;
const ISSUE = `${REPO}/issues/2766`;
const TASK_ID = "6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c";
const TASK = `${REPO}/tasks/${TASK_ID}`;

const mergedPull: TrackedEntry = {
  kind: "pull",
  number: 2790,
  title: "Utopia: mirror the default branch's commits",
  body: `Pushes each commit.\n\nCloses #2766\nLore-Task: ${TASK_ID}`,
  author: "gedaiu",
  labels: ["utopia", "lore"],
  openedAt: "2026-10-16T09:00:00Z",
  closedAt: "2026-10-16T21:08:00Z",
  mergedAt: "2026-10-16T21:08:00Z",
  updatedAt: "2026-10-16T21:09:00Z",
};

const openIssue: TrackedEntry = {
  kind: "issue",
  number: 2766,
  title: "Mirror the traceability graph into Utopia",
  body: "",
  author: "gedaiu",
  labels: [],
  openedAt: "2026-10-15T08:00:00Z",
  closedAt: null,
  mergedAt: null,
  updatedAt: "2026-10-15T08:30:00Z",
};

describe("trackerItems", () => {
  it("returns one pull:2790 item at its update time with title, state merged, author, labels, the three times, the body as text, and the issue it closes and the task it delivers", () => {
    expect(trackerItems(REPO, mergedPull)).toEqual([
      {
        externalId: "pull:2790",
        doc_time: "2026-10-16T21:09:00Z",
        e: [
          [REPO, "Repository", true],
          [PULL, "PullRequest", true],
          [ISSUE, "Issue", true],
          [TASK, "Task", true],
        ],
        s: [
          relation(REPO, "contains", PULL),
          attribute(PULL, "number", "2790"),
          attribute(PULL, "permalink", `https://github.com/${PULL}`),
          attribute(
            PULL,
            "title",
            "Utopia: mirror the default branch's commits",
          ),
          attribute(PULL, "state", "merged"),
          attribute(PULL, "author", "gedaiu"),
          attribute(PULL, "opened_at", "2026-10-16T09:00:00Z"),
          attribute(PULL, "labels", "utopia, lore"),
          attribute(PULL, "closed_at", "2026-10-16T21:08:00Z"),
          attribute(PULL, "merged_at", "2026-10-16T21:08:00Z"),
          attribute(
            PULL,
            "text",
            `Pushes each commit. Closes #2766 Lore-Task: ${TASK_ID}`,
          ),
          relation(PULL, "closes", ISSUE),
          relation(REPO, "contains", ISSUE),
          attribute(ISSUE, "number", "2766"),
          attribute(ISSUE, "permalink", `https://github.com/${ISSUE}`),
          relation(PULL, "delivers", TASK),
          relation(REPO, "contains", TASK),
          attribute(TASK, "task_id", TASK_ID),
        ],
      },
    ]);
  });

  it("returns one issue:2766 item with state open and no labels, closed_at, merged_at or text when the issue has none", () => {
    expect(trackerItems(REPO, openIssue)).toEqual([
      {
        externalId: "issue:2766",
        doc_time: "2026-10-15T08:30:00Z",
        e: [
          [REPO, "Repository", true],
          [ISSUE, "Issue", true],
        ],
        s: [
          relation(REPO, "contains", ISSUE),
          attribute(ISSUE, "number", "2766"),
          attribute(ISSUE, "permalink", `https://github.com/${ISSUE}`),
          attribute(
            ISSUE,
            "title",
            "Mirror the traceability graph into Utopia",
          ),
          attribute(ISSUE, "state", "open"),
          attribute(ISSUE, "author", "gedaiu"),
          attribute(ISSUE, "opened_at", "2026-10-15T08:00:00Z"),
        ],
      },
    ]);
  });

  it("states closed for a pull request closed without merging", () => {
    const [closedPull] = trackerItems(REPO, { ...mergedPull, mergedAt: null });

    expect(closedPull.s).toContainEqual(attribute(PULL, "state", "closed"));
  });

  it("links an issue to nothing when its body says Closes #3, since only a pull request closes an issue", () => {
    const [issueItem] = trackerItems(REPO, { ...openIssue, body: "Closes #3" });

    expect(issueItem.e.map((entity) => entity[1])).toEqual([
      "Repository",
      "Issue",
    ]);
  });

  it("splits a pull request closing 400 issues into items under the push limits, every one carrying the head and the text on the first only", () => {
    const body = Array.from({ length: 400 }, (_, n) => `Closes #${n + 1}`).join(
      "\n",
    );
    const parts = trackerItems(REPO, { ...mergedPull, body });
    const saysOfPull = (phrase: string) =>
      parts
        .filter((part) =>
          part.s.some((row) => row[1] === PULL && row[2] === phrase),
        )
        .map((part) => part.externalId);
    const ids = parts.map((part) => part.externalId);

    expect({
      firstTwo: ids.slice(0, 2),
      fit: parts.every(fitsOneItem),
      titled: saysOfPull("title"),
      withText: saysOfPull("text"),
    }).toEqual({
      firstTwo: ["pull:2790", "pull:2790.2"],
      fit: true,
      titled: ids,
      withText: ["pull:2790"],
    });
  });
});
