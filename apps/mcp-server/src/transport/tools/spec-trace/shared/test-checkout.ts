import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A throwaway directory the test process stands in, optionally a git checkout carrying a `.lore/test-commands.yml`; `leave()` steps back out and deletes it. */
export function enterCheckout(opts: { git: boolean; manifest?: string }): {
  root: string;
  leave: () => void;
} {
  const previous = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "lore-spec-trace-"));

  fillCheckout(root, opts);
  process.chdir(root);

  return {
    root,
    leave: () => {
      process.chdir(previous);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function fillCheckout(
  root: string,
  opts: { git: boolean; manifest?: string },
): void {
  if (opts.git) {
    execSync("git init -q", { cwd: root });
  }

  if (opts.manifest) {
    mkdirSync(join(root, ".lore"));
    writeFileSync(join(root, ".lore", "test-commands.yml"), opts.manifest);
  }
}
