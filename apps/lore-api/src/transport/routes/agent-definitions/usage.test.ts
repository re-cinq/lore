import { describe, it, expect } from "vitest";
import { usageOfPipelines, usageResponse } from "./usage.js";

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
});

const PIPELINE = `
line:
  id: implementation-loop
  nodes:
    - id: dod
      station: loop-dod
    - id: fix-ci
      station: loop-fix-ci
    - id: open-pr
      station: open-pr
    - id: done
stations:
  loop-dod:
    kind: agent
    agent_definition: loop-dod
  loop-fix-ci:
    kind: agent
    agent_definition: loop-fix-ci
  open-pr:
    kind: service
`;

describe("usageOfPipelines", () => {
  it("returns loop-dod and loop-fix-ci under implementation-loop and skips the service station", () => {
    expect(
      Object.fromEntries(
        usageOfPipelines([{ name: "loop.yaml", text: PIPELINE }]),
      ),
    ).toEqual({
      "loop-dod": [
        { blueprint: "implementation-loop", nodeId: "dod", inherited: true },
      ],
      "loop-fix-ci": [
        { blueprint: "implementation-loop", nodeId: "fix-ci", inherited: true },
      ],
    });
  });
});
