import { describe, it, expect } from "vitest";
import { enforceTrue } from "../../../lib/enforce.js";
import { mirrorTestReport, tombstoneTestFiles } from "./mirror-test-report.js";
import type { PushItem } from "../../../domain/utopia/statements.js";
import type { MirrorDeps } from "../push-items.js";
import type { PushAction } from "../../../outbound/utopia/utopia-client.js";

const run = {
  repo: "re-cinq/lore",
  tests: [
    { id: "a1", name: "adds", file: "src/a.test.ts", startLine: 3 },
    { id: "a2", name: "subtracts", file: "src/a.test.ts", startLine: 9 },
    { id: "b1", name: "divides", file: "src/b.test.ts", startLine: 4 },
  ],
  results: [
    { id: "a1", passed: true, covered: [] },
    { id: "a2", passed: true, covered: [] },
    { id: "b1", passed: false, covered: [] },
  ],
};

function pushClient(answer: (pushed: PushItem) => PushAction) {
  const pushed: PushItem[] = [];

  return {
    pushed,
    push: async (candidate: PushItem) => {
      pushed.push(candidate);

      return { action: answer(candidate) };
    },
  };
}

describe("mirrorTestReport", () => {
  it("pushes one item per test file and counts created and updated", async () => {
    const client = pushClient((candidate) =>
      candidate.externalId === "test:src/a.test.ts" ? "created" : "updated",
    );
    const outcome = await mirrorTestReport(withLedger(client), run);

    expect({
      outcome,
      ids: client.pushed.map((candidate) => candidate.externalId),
    }).toEqual({
      outcome: { items: 2, created: 1, updated: 1, unchanged: 0, failed: [] },
      ids: ["test:src/a.test.ts", "test:src/b.test.ts"],
    });
  });

  it("names the test file whose push threw while the rest land", async () => {
    const client = pushClient(() => "created");
    const failing = {
      push: async (candidate: PushItem) => {
        enforceTrue(
          candidate.externalId !== "test:src/a.test.ts",
          Error,
          "utopia answered 422: bad entity",
        );

        return client.push(candidate);
      },
    };
    const outcome = await mirrorTestReport(withLedger(failing), run);

    expect({
      outcome,
      ids: client.pushed.map((candidate) => candidate.externalId),
    }).toEqual({
      outcome: {
        items: 2,
        created: 1,
        updated: 0,
        unchanged: 0,
        failed: ["test:src/a.test.ts: utopia answered 422: bad entity"],
      },
      ids: ["test:src/b.test.ts"],
    });
  });
});

describe("tombstoneTestFiles", () => {
  it("pushes a test:<path> tombstone for each deleted test file", async () => {
    const client = pushClient(() => "marked_missing");
    const outcome = await tombstoneTestFiles(client, [
      "src/gone.test.ts",
      "src/old.test.ts",
    ]);

    expect({ outcome, pushed: client.pushed }).toEqual({
      outcome: { items: 2, created: 0, updated: 0, unchanged: 0, failed: [] },
      pushed: [
        { externalId: "test:src/gone.test.ts", deleted: true },
        { externalId: "test:src/old.test.ts", deleted: true },
      ],
    });
  });
});

class MemoryLedger {
  readonly byPath = new Map<string, string[]>();
  sweeps = 0;

  async pushedFor(path: string): Promise<string[]> {
    return this.byPath.get(path) ?? [];
  }

  async record(path: string, externalIds: string[]): Promise<void> {
    this.byPath.set(path, externalIds);
  }
}

function upkeptClient(ledger: MemoryLedger) {
  const client = pushClient(() => "created");

  return {
    client,
    deps: {
      push: client.push,
      ledger,
      sweepMissing: async () => {
        ledger.sweeps += 1;
      },
    },
  };
}

describe("mirrorTestReport with a ledger", () => {
  it("tombstones test:src/a.test.ts.2 when the last push had it and this one does not", async () => {
    const ledger = new MemoryLedger();

    ledger.byPath.set("test:src/a.test.ts", [
      "test:src/a.test.ts",
      "test:src/a.test.ts.2",
    ]);
    const { client, deps } = upkeptClient(ledger);

    await mirrorTestReport(deps, run);

    expect(
      client.pushed
        .filter((candidate) => "deleted" in candidate)
        .map((candidate) => candidate.externalId),
    ).toEqual(["test:src/a.test.ts.2"]);
  });

  it("records the item ids pushed for each test file", async () => {
    const ledger = new MemoryLedger();
    const { deps } = upkeptClient(ledger);

    await mirrorTestReport(deps, run);

    expect(Object.fromEntries(ledger.byPath)).toEqual({
      "test:src/a.test.ts": ["test:src/a.test.ts"],
      "test:src/b.test.ts": ["test:src/b.test.ts"],
    });
  });

  it("sweeps the source once after tombstoning a dropped part", async () => {
    const ledger = new MemoryLedger();

    ledger.byPath.set("test:src/a.test.ts", ["test:src/a.test.ts.2"]);
    ledger.byPath.set("test:src/b.test.ts", ["test:src/b.test.ts.2"]);
    const { deps } = upkeptClient(ledger);

    await mirrorTestReport(deps, run);

    expect(ledger.sweeps).toBe(1);
  });

  it("sweeps nothing when no part was dropped", async () => {
    const ledger = new MemoryLedger();
    const { deps } = upkeptClient(ledger);

    await mirrorTestReport(deps, run);

    expect(ledger.sweeps).toBe(0);
  });
});

function withLedger(client: { push: MirrorDeps["push"] }) {
  return {
    push: client.push,
    ledger: new MemoryLedger(),
    sweepMissing: async () => {},
  };
}
