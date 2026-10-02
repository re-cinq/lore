import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { UnlinkedSpec } from "@re-cinq/lore-shared/spec-upkeep/findings.js";
import { detectUnlinkedHandle } from "./station.js";

const UNLINKED: UnlinkedSpec = {
  specPath: "specs/cart/spec.md",
  statements: [{ text: "An empty cart totals zero.", ordinal: 4 }],
};

function scene(found: UnlinkedSpec[] | Error, driftCount = "0") {
  const produced: Record<string, string> = {};
  const branches: string[] = [];
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("")),
    produce: (name, content) => {
      produced[name] = String(content);

      return Promise.resolve();
    },
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
  const handle = detectUnlinkedHandle({
    findUnlinked: () =>
      found instanceof Error ? Promise.reject(found) : Promise.resolve(found),
    ensureBranch: (repo, branch) => {
      branches.push(`${repo} ${branch}`);

      return Promise.resolve();
    },
  });
  const run = () =>
    handle(
      {
        visitId: "visit-unlinked",
        iteration: 1,
        needs: {
          target: "github.com/acme/widgets@lore/spec-upkeep/2026-10-05",
          drift_count: driftCount,
        },
      },
      tools,
    );

  return { run, produced, branches };
}

describe("the spec-upkeep-detect-unlinked station", () => {
  it("produces the unlinked brief and a count of 1, and cuts the run's branch because there is work", async () => {
    const { run, produced, branches } = scene([UNLINKED]);

    expect(await run()).toEqual({
      outcome: "success",
      produced: { unlinked_count: "1" },
    });
    expect(produced.unlinked).toContain(
      "- Statement 4: An empty cart totals zero.",
    );
    expect(branches).toEqual(["acme/widgets lore/spec-upkeep/2026-10-05"]);
  });

  it("reports nothing and cuts no branch when no statement is unlinked and none drifted", async () => {
    const { run, branches } = scene([]);

    expect(await run()).toEqual({ outcome: "nothing" });
    expect(branches).toEqual([]);
  });

  it("goes on with a count of 0 when no statement is unlinked but 2 specs drifted", async () => {
    const { run, produced, branches } = scene([], "2");

    expect(await run()).toEqual({
      outcome: "success",
      produced: { unlinked_count: "0" },
    });
    expect(produced.unlinked).toBe("# Statements with no test link\n");
    expect(branches).toEqual(["acme/widgets lore/spec-upkeep/2026-10-05"]);
  });

  it("reports failed with the error when the graph cannot be read", async () => {
    const { run } = scene(new Error("graph down"));

    expect(await run()).toEqual({ outcome: "failed", error: "graph down" });
  });
});
