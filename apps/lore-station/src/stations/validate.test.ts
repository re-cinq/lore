import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { runValidateStation } from "./validate.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

const execFile = promisify(execFileCb);

const input: StationInput = {
  assembly_line_id: "al-1",
  node_id: "validate",
  node_type: "validate",
  repo: "owner/repo",
  branch: "lore/x",
  task_id: "t-1",
  params: { validator: "all" },
};

describe("runValidateStation", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-station-ws-"));
    const target = path.join(workspaceDir, "target");

    await fs.mkdir(target);
    await execFile("git", ["-C", target, "init", "-b", "main"]);
    await execFile("git", ["-C", target, "config", "user.email", "t@e.st"]);
    await execFile("git", ["-C", target, "config", "user.name", "t"]);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("reports success with no-tooling extras for an empty repo", async () => {
    const result = await runValidateStation(input, { workspaceDir });

    expect(result).toMatchObject({
      outcome: "success",
      extras: { "Lore-Validation": "none" },
    });
  });
});
