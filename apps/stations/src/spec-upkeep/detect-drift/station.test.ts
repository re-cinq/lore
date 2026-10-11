import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { DriftedSpec } from "@re-cinq/lore-shared/spec-upkeep/findings.js";
import { detectDriftHandle } from "./station.js";

const BRIEF = {
  visitId: "visit-drift",
  iteration: 1,
  needs: {
    target: "https://github.com/acme/widgets@lore/spec-upkeep/2026-10-05",
  },
};

const DRIFTED: DriftedSpec = {
  specPath: "specs/cart/spec.md",
  statements: [
    {
      text: "The cart totals its lines.",
      ordinal: 3,
      reason: "violated",
      links: [],
    },
  ],
};

function scene(found: DriftedSpec[] | Error) {
  const produced: Record<string, string> = {};
  const asked: string[] = [];
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("")),
    produce: (name, content) => {
      produced[name] = String(content);

      return Promise.resolve();
    },
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
  const handle = detectDriftHandle({
    findDrift: (repo) => {
      asked.push(repo);

      return found instanceof Error
        ? Promise.reject(found)
        : Promise.resolve(found);
    },
  });

  return { run: () => handle(BRIEF, tools), produced, asked };
}

describe("the spec-upkeep-detect-drift station", () => {
  it("reads the drift of acme/widgets and produces the brief as the drift file, with a count of 1", async () => {
    const { run, produced, asked } = scene([DRIFTED]);

    expect(await run()).toEqual({
      outcome: "success",
      produced: { drift_count: "1" },
    });
    expect(asked).toEqual(["acme/widgets"]);
    expect(produced.drift).toContain("## specs/cart/spec.md");
  });

  it("produces a count of 0 and a brief with no spec when nothing drifted", async () => {
    const { run, produced } = scene([]);

    expect(await run()).toEqual({
      outcome: "success",
      produced: { drift_count: "0" },
    });
    expect(produced.drift).toBe("# Drifted statements\n");
  });

  it("reports failed with the error when the specs cannot be read", async () => {
    const { run } = scene(new Error("chunk store down"));

    expect(await run()).toEqual({
      outcome: "failed",
      error: "chunk store down",
    });
  });
});
