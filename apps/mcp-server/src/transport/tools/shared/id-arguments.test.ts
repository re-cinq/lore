import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkedToolHandlers } from "./tool-test-helpers.js";
import { registerGetRunTool } from "../runs/get-run.js";
import { registerGetRunTranscriptTool } from "../runs/get-run-transcript.js";
import { registerGetRunNodeLogsTool } from "../runs/get-run-node-logs.js";
import { registerRetryStationTool } from "../runs/retry-station.js";
import { registerGetRunAssetsTool } from "../runs/get-run-assets.js";
import { registerGetRunBlobTool } from "../runs/get-run-blob.js";
import { registerListTaskGroupTool } from "../pipeline/list-task-group.js";

const fetchMock = vi.fn();
const TOOLS_DIR = join(import.meta.dirname, "..");

const TOOLS = {
  lore_get_run: { register: registerGetRunTool, others: {} },
  lore_get_run_transcript: {
    register: registerGetRunTranscriptTool,
    others: { run_id: "run-1" },
  },
  lore_get_run_node_logs: {
    register: registerGetRunNodeLogsTool,
    others: { run_id: "run-1" },
  },
  lore_retry_station: {
    register: registerRetryStationTool,
    others: { run_id: "run-1" },
  },
  lore_get_run_assets: { register: registerGetRunAssetsTool, others: {} },
  lore_get_run_blob: {
    register: registerGetRunBlobTool,
    others: { hash: `sha256-${"0".repeat(64)}` },
  },
  lore_list_task_group: { register: registerListTaskGroupTool, others: {} },
} as const;

async function refusals(tool: keyof typeof TOOLS, argument: string) {
  const { register, others } = TOOLS[tool];
  const registered = checkedToolHandlers(register as never, "agent")[tool];

  return Promise.all(
    [".", ".."].map((id) =>
      registered({ ...others, [argument]: id }).then(
        () => "accepted",
        () => "refused",
      ),
    ),
  );
}

function toolSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return toolSources(path);
    }

    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

describe("an id that becomes a segment of a lore-api path", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["lore_get_run", "run_id"],
    ["lore_get_run_transcript", "run_id"],
    ["lore_get_run_transcript", "visit_id"],
    ["lore_get_run_node_logs", "run_id"],
    ["lore_get_run_node_logs", "node"],
    ["lore_retry_station", "run_id"],
    ["lore_retry_station", "node"],
    ["lore_get_run_assets", "run_id"],
    ["lore_get_run_blob", "run_id"],
    ["lore_list_task_group", "group_id"],
  ] as const)(
    "%s refuses a dot segment as %s at the registered tool and asks lore-api nothing",
    async (tool, argument) => {
      expect({
        answers: await refusals(tool, argument),
        asked: fetchMock.mock.calls.length,
      }).toEqual({ answers: ["refused", "refused"], asked: 0 });
    },
  );

  it("is encoded by apiSegment alone: no tool calls encodeURIComponent itself, which lets a dot segment through", () => {
    const offenders = toolSources(TOOLS_DIR)
      .filter((path) => !path.endsWith(join("shared", "api-segment.ts")))
      .filter((path) =>
        readFileSync(path, "utf8").includes("encodeURIComponent("),
      )
      .map((path) => relative(TOOLS_DIR, path));

    expect(offenders).toEqual([]);
  });
});
