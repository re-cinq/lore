/** Locates the monorepo root from any test's cwd by walking up until `scripts/infra` appears; a hardcoded `join(process.cwd(), "..")` broke silently when the package moved to `libs/shared/`. */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { enforceTrue } from "./enforce.js";

export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;

  for (;;) {
    if (existsSync(join(dir, "scripts", "infra"))) {
      return dir;
    }
    const parent = dirname(dir);

    enforceTrue(
      parent !== dir,
      Error,
      `no scripts/infra directory found above ${start}`,
    );
    dir = parent;
  }
}
