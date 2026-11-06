import { describe, it, expect } from "vitest";
import { mirrorCodeFiles, tombstoneCodeFiles } from "./mirror-code.js";
import { MAX_CODE_FILE_CHARS } from "../../spec-trace/project-code-file.js";
import { relation, type PushItem } from "../../../domain/utopia/statements.js";
import type { PushAction } from "../../../outbound/utopia/utopia-client.js";

class MemoryLedger {
  readonly byKey = new Map<string, string[]>();
  sweeps = 0;

  async pushedFor(key: string): Promise<string[]> {
    return this.byKey.get(key) ?? [];
  }

  async record(key: string, externalIds: string[]): Promise<void> {
    this.byKey.set(key, externalIds);
  }
}

function pushClient(answer: PushAction, ledger = new MemoryLedger()) {
  const pushed: PushItem[] = [];

  return {
    pushed,
    ledger,
    sweepMissing: async () => {
      ledger.sweeps += 1;
    },
    push: async (candidate: PushItem) => {
      pushed.push(candidate);

      return { action: answer };
    },
  };
}

const RUNNER = [
  'import { nextTransition } from "./transition.js";',
  "",
  "export function advance(state: number) {",
  "  return nextTransition(state);",
  "}",
].join("\n");

describe("mirrorCodeFiles", () => {
  it("pushes code:src/runner.ts with advance referencing src/transition.ts#nextTransition and skips a file past MAX_CODE_FILE_CHARS", async () => {
    const client = pushClient("created");
    const outcome = await mirrorCodeFiles(client, {
      repo: "re-cinq/lore",
      files: [
        { path: "src/runner.ts", content: RUNNER },
        { path: "src/huge.ts", content: "x".repeat(MAX_CODE_FILE_CHARS + 1) },
      ],
    });
    const references = client.pushed.flatMap((pushed) =>
      "s" in pushed ? pushed.s.filter((row) => row[2] === "references") : [],
    );

    expect({
      outcome,
      ids: client.pushed.map((pushed) => pushed.externalId),
      references,
    }).toEqual({
      outcome: { items: 1, created: 1, updated: 0, unchanged: 0, failed: [] },
      ids: ["code:src/runner.ts"],
      references: [
        relation(
          "re-cinq/lore:src/runner.ts#advance",
          "references",
          "re-cinq/lore:src/transition.ts#nextTransition",
        ),
      ],
    });
  });
});

describe("mirrorCodeFiles with a ledger", () => {
  it("records code:src/runner.ts and its parts in the ledger and tombstones the part dropped since the last push", async () => {
    const ledger = new MemoryLedger();

    ledger.byKey.set("code:src/runner.ts", [
      "code:src/runner.ts",
      "code:src/runner.ts.2",
    ]);
    const client = pushClient("updated", ledger);

    await mirrorCodeFiles(client, {
      repo: "re-cinq/lore",
      files: [{ path: "src/runner.ts", content: RUNNER }],
    });

    expect({
      ids: client.pushed.map((pushed) => pushed.externalId),
      tombstoned: client.pushed.filter((pushed) => "deleted" in pushed),
      recorded: Object.fromEntries(ledger.byKey),
      sweeps: ledger.sweeps,
    }).toEqual({
      ids: ["code:src/runner.ts", "code:src/runner.ts.2"],
      tombstoned: [{ externalId: "code:src/runner.ts.2", deleted: true }],
      recorded: { "code:src/runner.ts": ["code:src/runner.ts"] },
      sweeps: 1,
    });
  });
});

describe("tombstoneCodeFiles", () => {
  it("pushes the ledgered parts and the code:<path> tombstone for each deleted source file, then sweeps once", async () => {
    const ledger = new MemoryLedger();

    ledger.byKey.set("code:src/gone.ts", [
      "code:src/gone.ts",
      "code:src/gone.ts.2",
    ]);
    const client = pushClient("marked_missing", ledger);

    await tombstoneCodeFiles(client, ["src/gone.ts", "src/old.ts"]);

    expect({
      pushed: client.pushed,
      recorded: Object.fromEntries(ledger.byKey),
      sweeps: ledger.sweeps,
    }).toEqual({
      pushed: [
        { externalId: "code:src/gone.ts", deleted: true },
        { externalId: "code:src/gone.ts.2", deleted: true },
        { externalId: "code:src/old.ts", deleted: true },
      ],
      recorded: { "code:src/gone.ts": [], "code:src/old.ts": [] },
      sweeps: 1,
    });
  });
});
