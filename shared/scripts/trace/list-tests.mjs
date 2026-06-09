#!/usr/bin/env node
// Lore test-command interface -- `list`. Emits one descriptor per spec-trace
// test FILE. Per-`it` granularity is deliberately avoided: buildTestReport runs
// every descriptor through `run` with NO concurrency cap, so 200+ its would
// fork-bomb the box. One vitest+coverage process per file is survivable.
import { execFileSync } from "node:child_process";

const SCOPE = process.env.LORE_TRACE_SCOPE || "src/spec-trace"; // runs with cwd=<pkg>
const PKG = process.env.LORE_TRACE_PKG || "shared"; // repo-relative prefix Lore expects on every path

function listFromVitest() {
  // vitest leaks sourcemap warnings around the JSON; slice the array out.
  const out = execFileSync("npx", ["vitest", "list", SCOPE, "--json"], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const start = out.indexOf("[");
  const end = out.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("vitest list emitted no JSON array");
  return JSON.parse(out.slice(start, end + 1));
}

function repoRelative(absolutePath) {
  const marker = `/${PKG}/`;
  const at = absolutePath.indexOf(marker);
  return at === -1 ? absolutePath : absolutePath.slice(at + 1);
}

const testFiles = new Map();
for (const test of listFromVitest()) {
  const file = repoRelative(test.file);
  if (!file.startsWith(`${PKG}/src/`)) continue; // drop stale dist/ copies
  if (!testFiles.has(file)) testFiles.set(file, file.split("/").pop());
}

const descriptors = [...testFiles].map(([file, name]) => ({ id: file, name, file }));
process.stdout.write(JSON.stringify(descriptors));
