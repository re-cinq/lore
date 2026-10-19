import { describe, expect, it } from "vitest";
import { orgMemoryWalk } from "./org-memory-walk.js";
import type { BackfillAnswer } from "./utopia-backfill-tick.js";

const walked = (
  memories: { entries: number; pass_complete: boolean },
  episodes: { entries: number },
  failed: string[] = [],
): BackfillAnswer => ({
  status: 200,
  body: JSON.stringify({
    memories: {
      from: null,
      to: null,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed,
      ...memories,
    },
    episodes: {
      from: null,
      to: null,
      created: episodes.entries,
      updated: 0,
      unchanged: 0,
      failed: [],
      ...episodes,
    },
  }),
});

function scene(answers: BackfillAnswer[]) {
  const logged: string[] = [];
  let walks = 0;

  return {
    deps: {
      walk: () => Promise.resolve(answers[walks++] ?? answers.at(-1)!),
      log: (line: string) => logged.push(line),
    },
    logged,
    walks: () => walks,
  };
}

describe("orgMemoryWalk", () => {
  it("walks the org base three times until its memories pass is complete and no episode is left, and reports it drained", async () => {
    const { deps, walks } = scene([
      walked({ entries: 200, pass_complete: false }, { entries: 200 }),
      walked({ entries: 40, pass_complete: true }, { entries: 120 }),
      walked({ entries: 0, pass_complete: true }, { entries: 0 }),
    ]);

    expect({ outcome: await orgMemoryWalk(deps), walks: walks() }).toEqual({
      outcome: "org memory: drained in 3 walks",
      walks: 3,
    });
  });

  it("stops after 20 walks when episodes keep coming, and reports the base not drained", async () => {
    const { deps, walks } = scene([
      walked({ entries: 0, pass_complete: true }, { entries: 200 }),
    ]);

    expect({ outcome: await orgMemoryWalk(deps), walks: walks() }).toEqual({
      outcome: "org memory: not drained after 20 walks",
      walks: 20,
    });
  });

  it("stops at the first walk lore-api refuses with 409 utopia_org_not_named and reports it", async () => {
    const { deps, walks } = scene([
      { status: 409, body: '{"code":"utopia_org_not_named"}' },
    ]);

    expect({ outcome: await orgMemoryWalk(deps), walks: walks() }).toEqual({
      outcome: 'org memory: HTTP 409 {"code":"utopia_org_not_named"}',
      walks: 1,
    });
  });

  it("stops at a walk whose push failed, logging the failure, and reports the base not drained", async () => {
    const { deps, logged } = scene([
      walked({ entries: 3, pass_complete: false }, { entries: 0 }, [
        "memory:a/k: 502",
      ]),
    ]);

    expect({ outcome: await orgMemoryWalk(deps), logged }).toEqual({
      outcome: "org memory: a push failed on walk 1",
      logged: ["org memory:   failed: memory:a/k: 502"],
    });
  });
});
