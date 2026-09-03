// Pod-based validate station (branch pre-cloned at $WORKSPACE_DIR/target, no relay; ADR-025).

import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  createValidateHandler,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import type { StationEnv } from "../lib/station.js";

const execFile = promisify(execFileCb);

/** Changed files vs default branch to scope lint/typecheck; undefined if diff unavailable. */
async function changedFiles(gitDir: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFile("git", [
      "-C",
      gitDir,
      "diff",
      "--name-only",
      "origin/HEAD...HEAD",
    ]);
    const files = stdout.split("\n").filter((f) => f.length > 0);

    return files.length > 0 ? files : undefined;
  } catch {
    return undefined;
  }
}

export async function runValidateStation(
  input: StationInput,
  env: StationEnv,
): Promise<NodeResult> {
  const gitDir = path.join(env.workspaceDir, "target");
  const changed = await changedFiles(gitDir);
  const handler = createValidateHandler(
    changed ? { changedFiles: () => changed } : {},
  );

  return handler(
    { id: input.node_id, type: "validate" },
    {
      taskId: input.task_id ?? "",
      assemblyRunId: input.assembly_run_id,
      branchName: input.branch,
      gitDir,
      iteration: 0,
      assemblyLineName: input.node_type,
    },
  );
}
