#!/usr/bin/env node
// Lore test-command interface -- `list`. Emits per-`it` descriptors across ALL
// traceability packages. There is no root vitest workspace, so run `vitest list`
// in each package's own cwd and merge. Per-`it` granularity + the describe-chain
// name/suite[] come from the pure, unit-tested `descriptorsFromVitestList`; this
// script is just the per-package vitest spawn + JSON merge. `run` executes one
// whole FILE per invocation (coverage is file-level) under buildTestReport's
// concurrency cap, so per-`it` listing does not fork-bomb.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descriptorsFromVitestList } from "../../dist/spec-trace/trace-descriptors.js";

const ROOT = process.cwd(); // manifest cwd == repo root
// Packages whose `src/` tests feed the graph. Override to narrow scope, e.g.
// LORE_TRACE_PKGS=shared LORE_TRACE_SCOPE=src/spec-trace for the old behavior.
const PKGS = (process.env.LORE_TRACE_PKGS || "shared,agent,mcp-server,web-ui")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SCOPE = process.env.LORE_TRACE_SCOPE || "src"; // all src tests per package

function listPkg(pkg) {
  // Write vitest's JSON to a FILE, not stdout: CI node runtimes prepend stdout
  // noise (deprecation/experimental warnings) that would contaminate a parsed
  // stdout slice and crash the whole list. A file is immune to that.
  const dir = mkdtempSync(join(tmpdir(), "lore-trace-list-"));
  const jsonPath = join(dir, "list.json");
  try {
    execFileSync("npx", ["vitest", "list", SCOPE, `--json=${jsonPath}`], {
      cwd: join(ROOT, pkg),
      encoding: "utf-8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return descriptorsFromVitestList(JSON.parse(readFileSync(jsonPath, "utf-8")), { pkg });
  } catch (err) {
    // A package with no matching tests, or a genuine list failure, contributes
    // nothing — but say so, never drop a package silently.
    console.warn(`[trace] list: ${pkg} contributed no tests (${err instanceof Error ? err.message : String(err)})`);
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.stdout.write(JSON.stringify(PKGS.flatMap(listPkg)));
