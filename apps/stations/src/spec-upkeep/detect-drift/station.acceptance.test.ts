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

describe("spec-upkeep-detect-drift acceptance", () => {
  it("opens a link-rot issue when drift exists and no open PR exists for the repository", async () => {
    const createdIssues: Array<{
      title: string;
      body: string;
      labels?: string[];
    }> = [];
    const produced: Record<string, string> = {};

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
      findDrift: () => Promise.resolve([DRIFTED]),
      project: () =>
        Promise.resolve({
          pulls: {
            list: () => Promise.resolve([]),
          },
          issues: {
            create: (title: string, body: string, labels?: string[]) => {
              createdIssues.push({ title, body, labels });

              return Promise.resolve({
                number: 1,
                url: "https://github.com/acme/widgets/issues/1",
              });
            },
          },
        }),
    } as any);

    const result = await handle(BRIEF, tools);

    expect(result.outcome).toBe("success");
    expect(createdIssues).toHaveLength(1);
    expect(createdIssues[0].labels).toContain("spec-link-rot");
  });
});
