#!/usr/bin/env node
// Lore test-command interface -- `list`. Emits one descriptor per `it()`
// (carrying the full `describe > it` name + the describe ancestors as `suite[]`)
// so spec-sentence acceptance links can be derived from the describe nesting.
// The per-`it` -> descriptor transform is the pure, unit-tested
// `descriptorsFromVitestList`; this script is just the vitest spawn + JSON glue.
// NOTE: `run` still executes one whole FILE per invocation (coverage is
// file-level) and buildTestReport runs files under a concurrency cap, so the
// historical per-`it` fork-bomb no longer applies.
import { execFileSync } from "node:child_process";
import { descriptorsFromVitestList } from "../../dist/spec-trace/trace-descriptors.js";

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

process.stdout.write(JSON.stringify(descriptorsFromVitestList(listFromVitest(), { pkg: PKG })));
