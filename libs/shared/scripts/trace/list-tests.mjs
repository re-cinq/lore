#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bindDescriptorsToSpecLinks } from "../../dist/work/spec-trace/bind-descriptors-to-spec-links.js";
import { resolveTestLines } from "../../dist/work/spec-trace/resolve-test-lines.js";
import { PKGS, SCOPE } from "./trace-packages.mjs";

const ROOT = process.cwd(); // manifest cwd == repo root
const HERE = dirname(fileURLToPath(import.meta.url));

function listPkg(pkg) {
  const dir = mkdtempSync(join(tmpdir(), "lore-trace-list-"));
  const jsonPath = join(dir, "list.json");

  try {
    execFileSync(
      process.execPath,
      [join(HERE, "list-worker.mjs"), ROOT, pkg, SCOPE, jsonPath],
      {
        cwd: join(ROOT, pkg),
        encoding: "utf-8",
        maxBuffer: 128 * 1024 * 1024,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );

    return JSON.parse(readFileSync(jsonPath, "utf-8"));
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
