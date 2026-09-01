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
