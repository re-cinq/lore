import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "reanchor.mjs");

test("exits 0 with no output and rewrites no link, with or without --all", () => {
  const repo = mkdtempSync(join(tmpdir(), "reanchor-stub-"));
  const spec = "- Statement. ([validated by x](t.test.ts#L42))\n";

  try {
    writeFileSync(join(repo, "spec.md"), spec);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });

    const runs = [[], ["--all"]].map((args) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: repo,
        encoding: "utf8",
      }),
    );

    assert.deepEqual(
      runs.map(({ status, stdout, stderr }) => ({ status, stdout, stderr })),
      [
        { status: 0, stdout: "", stderr: "" },
        { status: 0, stdout: "", stderr: "" },
      ],
    );
    assert.equal(readFileSync(join(repo, "spec.md"), "utf8"), spec);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
