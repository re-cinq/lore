// The validate station: the exact same createValidateHandler the Floor used to
// run in-process, composed for the pod — the initializer already cloned the
// branch at $WORKSPACE_DIR/target, so validation runs against the real checkout
// in this image's toolchain (no relay sidecar needed, superseding ADR-025's
// relay for assembly-line validation).

import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  createValidateHandler,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

const execFile = promisify(execFileCb);

export interface StationEnv {
  workspaceDir: string;
}

/** Changed files vs the clone's default branch, to scope lint/typecheck; undefined
 *  (validate everything) when the diff can't be derived (fresh branch, no origin). */
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
    { id: input.node_id, type: "validate", validator: input.params.validator },
    {
      taskId: input.task_id ?? "",
      assemblyLineId: input.assembly_line_id,
      branchName: input.branch,
      gitDir,
      iteration: 0,
      assemblyLineName: input.node_type,
    },
  );
}
