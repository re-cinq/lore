/**
 * `trace:run-tests` — local CLI wrapper for the test-command interface
 * (project-test-interface). Runs the repo's declared `.lore/test-commands.yml`
 * `list`/`run` commands in the LOCAL trusted sandbox, assembles the
 * `POST /test-report` body via {@link buildTestReport}, and either prints it
 * (default) or POSTs it to the Lore API (`--post`).
 *
 * Execution happens here, on the developer's machine — the same trusted
 * context as the repo's CI and the claude-runner pod. The shared cluster
 * server refuses to execute (the `executionRefusal` gate inside
 * `buildTestReport`), so running this with `LORE_DB_HOST` set exits non-zero
 * with the "run in CI / locally" message.
 *
 * Usage: `node dist/trace-run-tests-cli.js [--post]`
 */

import { execFileSync } from "node:child_process";
import { buildTestReport, loadTestCommandManifest } from "./spec-trace-tools.js";
import { getRepoRoot, detectRepo } from "./local-runner.js";

function gitValue(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

async function main(): Promise<void> {
  const root = getRepoRoot() || process.cwd();

  const manifest = loadTestCommandManifest(root);
  if (!manifest) {
    console.error(
      "[trace] No .lore/test-commands.yml manifest found. Add one (e.g. via the /lore-test-commands setup prompt) before running trace:run-tests.",
    );
    process.exit(2);
  }

  const commit = gitValue(root, ["rev-parse", "HEAD"]);
  const branch = gitValue(root, ["rev-parse", "--abbrev-ref", "HEAD"]);

  const report = await buildTestReport(process.env, manifest, root, { commit, branch });

  if (!process.argv.includes("--post")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const apiUrl = process.env.LORE_API_URL;
  const token = process.env.LORE_INGEST_TOKEN;
  const repo = detectRepo();
  if (!apiUrl || !token || !repo) {
    console.error("[trace] --post requires LORE_API_URL, LORE_INGEST_TOKEN, and a detectable git remote (owner/repo).");
    process.exit(2);
  }

  const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/repos/${repo}/test-report`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!res.ok) {
    console.error(`[trace] POST /test-report failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.error(`[trace] Posted ${report.tests.length} tests / ${report.results.length} results for ${repo}@${commit.slice(0, 8)}.`);
}

main().catch((err: unknown) => {
  console.error(`[trace] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
