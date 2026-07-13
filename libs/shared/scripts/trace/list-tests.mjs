#!/usr/bin/env node
// Lore test-command interface -- `list`. Emits per-`it` descriptors across ALL
// traceability packages. There is no root vitest workspace, so run `vitest list`
// in each package's own cwd and merge. Per-`it` granularity + the describe-chain
// name/suite[] come from the pure, unit-tested `descriptorsFromVitestList`; this
// script is just the per-package vitest spawn + JSON merge. `run` executes one
// whole FILE per invocation (coverage is file-level) under buildTestReport's
// concurrency cap, so per-`it` listing does not fork-bomb.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descriptorsFromVitestList } from "../../dist/spec-trace/trace-descriptors.js";
import { bindDescriptorsToSpecLinks } from "../../dist/spec-trace/bind-descriptors-to-spec-links.js";
import { resolveTestLines } from "../../dist/spec-trace/resolve-test-lines.js";

const ROOT = process.cwd(); // manifest cwd == repo root
// Packages whose `src/` tests feed the graph. Override to narrow scope, e.g.
// LORE_TRACE_PKGS=libs/shared LORE_TRACE_SCOPE=src/spec-trace for the old behavior.
const PKGS = (
  process.env.LORE_TRACE_PKGS ||
  "libs/shared,libs/runner,libs/server-core,apps/floor,apps/lore-api,apps/mcp-server,apps/web-ui"
)
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

    return descriptorsFromVitestList(
      JSON.parse(readFileSync(jsonPath, "utf-8")),
      { pkg },
    );
  } catch (err) {
    // A package with no matching tests, or a genuine list failure, contributes
    // nothing — but say so, never drop a package silently.
    console.warn(
      `[trace] list: ${pkg} contributed no tests (${err instanceof Error ? err.message : String(err)})`,
    );

    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Read every spec markdown so inline `([validated by](test.ts#Lline))` links can
// stamp a `spec` anchor onto the descriptor of the test they name — turning each
// run into live `validated_by`/`violated` graph signal (ADR-023). A repo with no
// specs/ dir simply binds nothing.
function readSpecSources(root) {
  let entries;

  try {
    entries = readdirSync(join(root, "specs"), {
      recursive: true,
      encoding: "utf-8",
    });
  } catch {
    return [];
  }

  return entries
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => ({
      path: `specs/${rel}`.replaceAll("\\", "/"),
      content: readFileSync(join(root, "specs", rel), "utf-8"),
    }));
}

// `vitest list` is line-blind, so resolve each `it`'s line span from its source
// before binding — read each test file once and stamp [startLine, endLine] onto
// its descriptors (ADR-023).
function resolveLines(descriptors) {
  const byFile = new Map();

  for (const descriptor of descriptors) {
    const group =
      byFile.get(descriptor.file) ??
      byFile.set(descriptor.file, []).get(descriptor.file);

    group.push(descriptor);
  }
  const resolved = [];

  for (const [file, group] of byFile) {
    try {
      resolved.push(
        ...resolveTestLines(readFileSync(join(ROOT, file), "utf-8"), group),
      );
    } catch {
      resolved.push(...group); // unreadable file — leave its descriptors line-blind
    }
  }

  return resolved;
}

const descriptors = bindDescriptorsToSpecLinks(
  resolveLines(PKGS.flatMap(listPkg)),
  readSpecSources(ROOT),
);
const anchored = descriptors.filter(
  (descriptor) => descriptor.spec !== undefined,
);
const multi = anchored.filter((descriptor) => Array.isArray(descriptor.spec));

console.warn(
  `[trace] list: ${anchored.length} descriptor(s) anchored to statements (${multi.length} multi-statement).`,
);
process.stdout.write(JSON.stringify(descriptors));
