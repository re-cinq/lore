import { describe, expect, it } from "vitest";
import { mergeQueues } from "./merge-queues.js";

const LORE = "lore[bot]";

const pull = (number: number, over: Record<string, unknown> = {}) => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/acme/widgets/pull/${number}`,
  author: LORE,
  ...over,
});

const block = (
  prNumber: number,
  reason: string,
  detail: string | null = null,
) => ({
  prNumber,
  reason,
  detail,
  since: "2026-10-23T08:00:00Z",
});

describe("mergeQueues", () => {
  it("sorts Lore's open #1..#4 by arming and blocked reason, and leaves out a person's pull request", () => {
    const queues = mergeQueues({
      open: [
        pull(1, { autoMerge: true }),
        pull(2, { autoMerge: true }),
        pull(3),
        pull(4, { autoMerge: true }),
        pull(5, { author: "someone", autoMerge: true }),
      ],
      merged: [],
      blocks: [block(1, "waiting_on_ci"), block(4, "needs_code_owner")],
      appLogin: LORE,
    });

    expect({
      current: queues.current.map((r) => [r.pr_number, r.state, r.blocked]),
      awaiting: queues.awaiting_merge.map((r) => [r.pr_number, r.state]),
      backlog: queues.backlog.map((r) => [r.pr_number, r.state]),
      parked: queues.parked.map((r) => [r.pr_number, r.state, r.blocked]),
    }).toEqual({
      current: [[1, "armed", "Waiting for CI"]],
      awaiting: [[2, "armed"]],
      backlog: [[3, "open"]],
      parked: [[4, "blocked", "Needs a code owner's approval"]],
    });
  });

  it("parks an unarmed pull request held by a conflict, naming the branch", () => {
    const queues = mergeQueues({
      open: [pull(6)],
      merged: [],
      blocks: [block(6, "merge_conflict", "main")],
      appLogin: LORE,
    });

    expect(queues.parked.map((r) => [r.pr_number, r.blocked])).toEqual([
      [6, "Conflicts with main"],
    ]);
  });

  it("lists Lore's merged pull requests newest first under recent, ten at most", () => {
    const merged = Array.from({ length: 12 }, (_, i) =>
      pull(100 + i, {
        mergedAt: `2026-10-${String(1 + i).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const queues = mergeQueues({
      open: [],
      merged,
      blocks: [],
      appLogin: LORE,
    });

    expect({
      count: queues.recent.length,
      first: [queues.recent[0].pr_number, queues.recent[0].state],
    }).toEqual({ count: 10, first: [111, "merged"] });
  });

  it("lists nothing when Lore's App login is unknown, so a stranger's pull request never reads as Lore's", () => {
    const queues = mergeQueues({
      open: [pull(1, { author: undefined, autoMerge: true })],
      merged: [],
      blocks: [],
      appLogin: undefined,
    });

    expect([queues.current, queues.backlog, queues.awaiting_merge]).toEqual([
      [],
      [],
      [],
    ]);
  });

  it("keeps unarmed #8 waiting for its approval in the backlog until Lore's review arms it, and parks armed #9 still needing a code owner", () => {
    const queues = mergeQueues({
      open: [pull(8), pull(9, { autoMerge: true })],
      merged: [],
      blocks: [block(8, "needs_approval"), block(9, "needs_code_owner")],
      appLogin: LORE,
    });

    expect({
      backlog: queues.backlog.map((r) => [r.pr_number, r.state, r.blocked]),
      parked: queues.parked.map((r) => [r.pr_number, r.state]),
    }).toEqual({
      backlog: [[8, "open", "Needs one approval"]],
      parked: [[9, "blocked"]],
    });
  });
});
