import { describe, it, expect } from "vitest";
import { stationDefinitions, usageOfPipelines } from "./pipeline-agents.js";

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

describe("stationDefinitions", () => {
  it("returns loop-dod and loop-fix-ci keyed by their stations and leaves out the open-pr service station", () => {
    expect(
      Object.fromEntries(
        stationDefinitions([{ name: "loop.yaml", text: PIPELINE }]),
      ),
    ).toEqual({ "loop-dod": "loop-dod", "loop-fix-ci": "loop-fix-ci" });
  });
});
