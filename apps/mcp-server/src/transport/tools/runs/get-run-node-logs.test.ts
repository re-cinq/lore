import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { fakeLoreApi, specDescription } from "./shared/fake-lore-api.js";
import {
  GET_RUN_NODE_LOGS_DESCRIPTION,
  registerGetRunNodeLogsTool,
} from "./get-run-node-logs.js";

const api = fakeLoreApi();
const getLogs = toolHandlers(registerGetRunNodeLogsTool, "agent")[
  "lore_get_run_node_logs"
];
const textOf = async (args: Record<string, unknown>) =>
  (await getLogs(args)).content[0].text;

describe("lore_get_run_node_logs", () => {
  it("returns the log of visit floor-v1 of run r1", async () => {
    api.answer("/api/assembly-runs/r1/nodes/floor-v1/logs", {
      available: true,
      logs: "boom",
    });

    expect(
      JSON.parse(await textOf({ run_id: "r1", node: "floor-v1" })),
    ).toEqual({ available: true, logs: "boom" });
  });

  it("asks for the last 50 lines when tail is 50", async () => {
    await textOf({ run_id: "r1", node: "floor-v1", tail: 50 });

    expect(api.requested).toEqual([
      "/api/assembly-runs/r1/nodes/floor-v1/logs?tail=50",
    ]);
  });

  it("carries the verbatim description block of specs/mcp-tools/get-run-node-logs/spec.md", () => {
    expect(GET_RUN_NODE_LOGS_DESCRIPTION).toBe(
      specDescription("get-run-node-logs"),
    );
  });
});
