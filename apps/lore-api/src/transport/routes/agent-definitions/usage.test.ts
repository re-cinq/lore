import { describe, it, expect } from "vitest";
import { usageResponse } from "./usage.js";
import {
  loadBuiltinAssemblyLines,
  stationUsage,
} from "@re-cinq/lore-assembly-lines";

describe("usageResponse", () => {
  it("maps the walk's refs to snake_case wire entries sorted by name", () => {
    const usage = new Map([
      [
        "implementation",
        [{ blueprint: "implementation", nodeId: "implement", inherited: true }],
      ],
      [
        "def-validate",
        [{ blueprint: "implementation", nodeId: "validate", inherited: true }],
      ],
    ]);

    expect(usageResponse(usage)).toEqual({
      applied: [],
      usage: [
        {
          name: "def-validate",
          used_by: [
            {
              blueprint: "implementation",
              node_id: "validate",
              inherited: true,
            },
          ],
        },
        {
          name: "implementation",
          used_by: [
            {
              blueprint: "implementation",
              node_id: "implement",
              inherited: true,
            },
          ],
        },
      ],
    });
  });

  it("the builtin catalog's response names implementation but never runbook", async () => {
    const { usage } = usageResponse(
      stationUsage(await loadBuiltinAssemblyLines()),
    );
    const names = usage.map((entry) => entry.name);

    expect(names).toContain("implementation");
    expect(names).not.toContain("runbook");
  });
});

describe("apply status on the usage response", () => {
  it("carries each cluster's verdict through, reason included", () => {
    const applied = [
      {
        name: "review",
        project_id: null,
        cluster: "satellite-1",
        state: "refused" as const,
        reason: "no anthropic credential",
      },
    ];

    expect(usageResponse(new Map(), applied)).toEqual({ usage: [], applied });
  });

  it("defaults to no verdicts, which the caller reads as unknown rather than as all-applied", () => {
    expect(usageResponse(new Map()).applied).toEqual([]);
  });
});
