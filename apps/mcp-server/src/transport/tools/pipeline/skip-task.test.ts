import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerSkipTaskTool } from "./skip-task.js";

const fakeHome = mkdtempSync(join(tmpdir(), "lore-skip-home-"));
const pendingFile = join(fakeHome, ".lore", "pending-tasks.json");

process.env.HOME = fakeHome;

const skipTask = toolHandlers(registerSkipTaskTool, "full")["lore_skip_task"];

describe("lore_skip_task", () => {
  it("removes task t1 from the pending cache and keeps t2", async () => {
    mkdirSync(join(fakeHome, ".lore"), { recursive: true });
    writeFileSync(pendingFile, JSON.stringify([{ id: "t1" }, { id: "t2" }]));

    const result = await skipTask({ task_id: "t1" });

    expect({
      text: result.content[0].text,
      cache: JSON.parse(readFileSync(pendingFile, "utf-8")),
    }).toEqual({
      text: "Task t1 skipped. GKE will handle it.",
      cache: [{ id: "t2" }],
    });
  });

  it("returns the error text when the ~/.lore directory is missing", async () => {
    rmSync(join(fakeHome, ".lore"), { recursive: true, force: true });

    const result = await skipTask({ task_id: "t1" });

    expect(result.content[0].text).toMatch(/^Error skipping task: ENOENT/);
  });
});
