#!/usr/bin/env node
// Lore test-command interface -- `list`. Emits per-`it` descriptors across ALL
// traceability packages. There is no root vitest workspace, so run `vitest list`
// in each package's own cwd and merge. Per-`it` granularity + the describe-chain
// name/suite[] come from the pure, unit-tested `descriptorsFromVitestList`; this
// script is just the per-package vitest spawn + JSON merge. `run` executes one
// whole FILE per invocation (coverage is file-level) under buildTestReport's
// concurrency cap, so per-`it` listing does not fork-bomb.
import { execFileSync } from "node:child_process";
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
  let out;
  try {
    out = execFileSync("npx", ["vitest", "list", SCOPE, "--json"], {
      cwd: join(ROOT, pkg),
      encoding: "utf-8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return []; // a package with no matching tests / a transient list failure contributes nothing
  }
  const start = out.indexOf("[");
  const end = out.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  return descriptorsFromVitestList(JSON.parse(out.slice(start, end + 1)), { pkg });
}

process.stdout.write(JSON.stringify(PKGS.flatMap(listPkg)));
