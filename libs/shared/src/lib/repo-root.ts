/**
 * Locates the monorepo root from any test's cwd by walking up until the
 * `scripts/infra` directory appears. The live-Dgraph suites shell out to the
 * schema appliers there; a hardcoded `join(process.cwd(), "..")` broke for
 * every one of them when the package moved from `shared/` to `libs/shared/`
 * (unnoticed because the suites skip without a reachable Dgraph).
 */

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
