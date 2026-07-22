#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

const SHARED_PACKAGES = [
  "lore-shared",
  "lore-assembly-lines",
  "lore-server-core",
];

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const detectLinkedWorktreeRoot = () => {
  if (process.env.CI) {
    return null;
  }

  try {
    const root = git(["rev-parse", "--show-toplevel"]);
    const gitDir = path.resolve(root, git(["rev-parse", "--git-dir"]));
    const commonDir = path.resolve(
      root,
      git(["rev-parse", "--git-common-dir"]),
    );

    return gitDir === commonDir ? null : root;
  } catch {
    return null;
  }
};

const findEscapedResolutions = (root) => {
  const realRoot = realpathSync(root);
  const escaped = [];

  for (const name of SHARED_PACKAGES) {
    const link = path.join(root, "node_modules", "@re-cinq", name);

    if (!existsSync(link)) {
      continue;
    }
    const real = realpathSync(link);

    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      escaped.push({ name, real });
    }
  }

  return escaped;
};

const root = detectLinkedWorktreeRoot();

if (!root) {
  process.exit(0);
}

const escaped = findEscapedResolutions(root);

if (escaped.length === 0) {
  process.exit(0);
}

const log = (line) => process.stderr.write(`[lore] ${line}\n`);

log("preflight: shared packages resolve OUTSIDE this worktree:");

for (const { name, real } of escaped) {
  log(`  @re-cinq/${name} -> ${real}`);
}
log("");
log(
  "tsc will typecheck against that stale dist while vitest reads your edited",
);
log("source through path aliases — a clean local run can still fail CI (see");
log('CONTRIBUTING.md "Working in a git worktree").');
log("");
log("Fix one of:");
log(
  "  1. npm install                          # give this worktree its own node_modules",
);
log("  2. build the shared packages here and repoint the symlinks, e.g.:");
log(
  '     (cd libs/shared && npx tsc) && ln -sfn "$PWD/libs/shared" node_modules/@re-cinq/lore-shared',
);
process.exit(1);
