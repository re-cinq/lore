/**
 * Local (deterministic) execution of a graph-ingest task via the MCP server.
 * Reads the dev's WORKING TREE off disk and projects into the local Dgraph
 * (LORE_DGRAPH_HTTP, e.g. localhost:8081) by calling the shared, runtime-
 * agnostic `runIngestGraph` directly — the same core the agent worker runs. The
 * MCP server can import it because the spec-trace layer lives in
 * @re-cinq/lore-shared. Tests run the project test interface, so they execute
 * here only (the trusted local sandbox), never on the shared agent.
 */

import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, sep, dirname } from "node:path";
import { createDgraphClient, runIngestGraph, type IngestGraphSummary } from "@re-cinq/lore-shared";
import { GitCli } from "@re-cinq/lore-shared/project/workspace/git-cli.js";
import { buildTestReport as buildTestReportCmd, loadTestCommandManifest } from "./spec-trace-tools.js";
import { getRepoRoot, detectRepo } from "./local-runner.js";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".lore-pgdata", ".lore-dgraphdata"]);
// Markdown for specs/adrs, .ts/.tsx for the code kind. Per-kind selection
// (extension + prefix + exclude) is the authoritative filter in selectIngestFiles.
const PROJECTABLE_EXTENSIONS = [".md", ".ts", ".tsx"];

/** Recursively lists projectable files under `root` as repo-relative POSIX paths. */
export function localTreeFromFs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (PROJECTABLE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
        out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out;
}

/**
 * Resolves the directory to read the repo's files from: the cwd working tree
 * when it IS the target repo (the dev's uncommitted view), else a stable
 * `/tmp/lore-cache/<owner>/<repo>` clone that is REUSED across runs (fetch +
 * checkout, never re-cloned) and pinned to `ref` (branch/commit) when given.
 */
export async function resolveContentSource(targetRepo: string, ref?: string): Promise<string> {
  const cwdRoot = getRepoRoot();
  if (cwdRoot && detectRepo() === targetRepo) {
    return cwdRoot;
  }
  const cacheDir = join(tmpdir(), "lore-cache", ...targetRepo.split("/"));
  mkdirSync(dirname(cacheDir), { recursive: true });
  const git = new GitCli();
  await git.ensureClone(targetRepo, cacheDir, ref ? { ref } : undefined);
  if (ref) await git.ensureCheckout(cacheDir, ref);
  return cacheDir;
}

export async function runLocalGraphIngest(
  kind: string,
  repo: string,
  repoRoot: string,
  buildTestReport?: () => Promise<unknown>,
): Promise<IngestGraphSummary> {
  const dgraph = createDgraphClient(process.env);
  return runIngestGraph(
    { kind, repo },
    {
      dgraph,
      listTree: async () => localTreeFromFs(repoRoot),
      readFile: async (path) => readFileSync(join(repoRoot, path), "utf-8"),
      buildTestReport,
    },
  );
}

function gitMeta(root: string): { commit: string; branch: string } {
  try {
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
    const branch = execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf-8" }).trim();
    return { commit, branch };
  } catch {
    return { commit: "", branch: "" };
  }
}

/** POSTs a status update to /api/task so the UI reflects the run (best-effort). */
async function postStatus(taskId: string, status: string, error?: string): Promise<void> {
  const apiUrl = process.env.LORE_API_URL;
  const token = process.env.LORE_INGEST_TOKEN;
  if (!apiUrl || !token) return;
  await fetch(`${apiUrl}/api/task`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId, status, ...(error ? { error } : {}) }),
  }).catch(() => {});
}

/**
 * End-to-end local run of an `ingest-<kind>` task: drives status (running →
 * completed | failed) via the API so the UI updates, builds the test-interface
 * report for the tests kind, and returns the summary message for the tool reply.
 */
export async function executeGraphIngestLocally(
  task: { id: string; task_type: string; target_repo: string },
  repoRoot: string,
): Promise<{ status: string; message: string }> {
  const kind = task.task_type.replace(/^ingest-/, "");
  await postStatus(task.id, "running");
  try {
    let buildTestReport: (() => Promise<unknown>) | undefined;
    if (kind === "tests") {
      const manifest = loadTestCommandManifest(repoRoot);
      if (manifest) {
        const meta = gitMeta(repoRoot);
        buildTestReport = () => buildTestReportCmd(process.env, manifest, repoRoot, meta);
      }
    }
    const summary = await runLocalGraphIngest(kind, task.target_repo, repoRoot, buildTestReport);
    const status = summary.status === "failed" ? "failed" : "completed";
    await postStatus(task.id, status, summary.status === "failed" ? summary.message : undefined);
    return { status, message: summary.message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postStatus(task.id, "failed", message);
    return { status: "failed", message: `Ingestion failed: ${message}` };
  }
}
