import { describe, it, expect } from "vitest";
import type { TrackerActivityOptions } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { TrackedEntry } from "@re-cinq/lore-shared/utopia/tracker-statements.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/push-items.js";
import { mirrorBranchCommits } from "./git-history/utopia-commits.js";
import { mirrorTracker, type TrackerDeps } from "./utopia-tracker.js";

const entry = (
  kind: TrackedEntry["kind"],
  number: number,
  updatedAt: string,
): TrackedEntry => ({
  kind,
  number,
  title: `Title ${number}`,
  body: "",
  author: "gedaiu",
  labels: [],
  openedAt: "2026-10-01T00:00:00Z",
  closedAt: null,
  mergedAt: null,
  updatedAt,
});

const LANDED: MirrorOutcome = {
  items: 1,
  created: 1,
  updated: 0,
  unchanged: 0,
  failed: [],
};

function walk(setup: {
  cursor?: string | null;
  activity: TrackedEntry[];
  outcomes?: Record<string, () => MirrorOutcome>;
}) {
  const asked: TrackerActivityOptions[] = [];
  const mirrored: string[] = [];
  const cursors: string[] = [];
  const deps: TrackerDeps = {
    repo: "re-cinq/lore",
    tracker: {
      trackerActivity: async (opts) => {
        asked.push(opts);

        return setup.activity;
      },
    },
    cursor: {
      read: async () => setup.cursor ?? null,
      write: async (since) => {
        cursors.push(since);
      },
    },
    mirror: async (tracked) => {
      const id = `${tracked.kind}:${tracked.number}`;

      mirrored.push(id);

      return (setup.outcomes?.[id] ?? (() => LANDED))();
    },
  };

  return { deps, asked, mirrored, cursors };
}

describe("mirrorTracker", () => {
  it("asks for the 200 entries updated since the stored cursor, mirrors pull 6 then issue 5, moves the cursor to each one's update time, and answers from the cursor to the last", async () => {
    const { deps, asked, mirrored, cursors } = walk({
      cursor: "2026-10-16T00:00:00Z",
      activity: [
        entry("pull", 6, "2026-10-16T01:00:00Z"),
        entry("issue", 5, "2026-10-16T02:00:00Z"),
      ],
      outcomes: { "issue:5": () => ({ ...LANDED, created: 0, updated: 1 }) },
    });

    expect({
      summary: await mirrorTracker(deps),
      asked,
      mirrored,
      cursors,
    }).toEqual({
      summary: {
        from: "2026-10-16T00:00:00Z",
        to: "2026-10-16T02:00:00Z",
        entries: 2,
        created: 1,
        updated: 1,
        unchanged: 0,
        failed: [],
      },
      asked: [{ since: "2026-10-16T00:00:00Z", limit: 200 }],
      mirrored: ["pull:6", "issue:5"],
      cursors: ["2026-10-16T01:00:00Z", "2026-10-16T02:00:00Z"],
    });
  });

  it("asks from the beginning when no cursor is stored", async () => {
    const { deps, asked } = walk({ activity: [] });

    await mirrorTracker(deps);

    expect(asked).toEqual([{ limit: 200 }]);
  });

  it("stops at pull 6, whose push Utopia refused, leaving the cursor at issue 5's update time and naming pull:6 under failed", async () => {
    const { deps, mirrored, cursors } = walk({
      activity: [
        entry("issue", 5, "2026-10-16T01:00:00Z"),
        entry("pull", 6, "2026-10-16T02:00:00Z"),
        entry("issue", 7, "2026-10-16T03:00:00Z"),
      ],
      outcomes: {
        "pull:6": () => {
          throw new Error("Utopia answered 503");
        },
      },
    });

    expect({
      summary: await mirrorTracker(deps),
      mirrored,
      cursors,
    }).toEqual({
      summary: {
        from: null,
        to: "2026-10-16T01:00:00Z",
        entries: 1,
        created: 1,
        updated: 0,
        unchanged: 0,
        failed: ["pull:6: Utopia answered 503"],
      },
      mirrored: ["issue:5", "pull:6"],
      cursors: ["2026-10-16T01:00:00Z"],
    });
  });

  it("waits for a commit walk of re-cinq/lore still pushing before it reads its own cursor, so one repo has one walk in flight", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commitWalk = mirrorBranchCommits(
      {
        repo: "re-cinq/lore",
        history: {
          branchHistory: async () => [
            {
              sha: "c1",
              parents: [],
              subject: "One",
              body: "",
              author: "a",
              authoredAt: "t",
            },
          ],
        },
        cursor: { read: async () => null, write: async () => {} },
        mirror: async () => {
          order.push("commit walk pushing");
          await held;
          order.push("commit walk done");

          return LANDED;
        },
      },
      "main",
    );
    const { deps } = walk({ activity: [] });

    deps.cursor.read = async () => {
      order.push("tracker walk reading cursor");

      return null;
    };
    const trackerWalk = mirrorTracker(deps);

    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await Promise.all([commitWalk, trackerWalk]);

    expect(order).toEqual([
      "commit walk pushing",
      "commit walk done",
      "tracker walk reading cursor",
    ]);
  });
});
