#!/usr/bin/env node
// Asserts that every path DECLARED outside TypeScript actually resolves.
//
// These are the paths no compiler reads and no test exercises: a package's own
// `main`/`types`/`exports`/`bin`, the `node dist/...` commands in Helm charts and
// Dockerfiles, and npm scripts. Nothing inside a package reads its own manifest,
// so a package can build clean, pass every test, and still be unloadable by its
// consumers — which is how a rename broke main and would have stopped every
// station pod from starting.
//
// Requires a build first: it checks the paths against real dist output.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const problems = [];
const skipped = [];

function note(where, what) {
  problems.push(`${where}\n    ${what}`);
}

/** The directory a declared path lives in, glob or not.
 *
 * The part before the FIRST glob character: `dirname` of the whole pattern is
 * wrong for `**` (itself a segment), and `dirname` of the prefix walks one
 * level too far, which let a renamed folder pass. */
function probeDir(target) {
  const fixed = target.split(/[*?]/)[0];

  return fixed.endsWith("/") ? fixed.slice(0, -1) : dirname(fixed);
}

/** Every workspace package.json, found by walking the workspace globs. */
function workspacePackages() {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const dirs = new Set();

  for (const pattern of root.workspaces ?? []) {
    if (pattern.endsWith("/*")) {
      const parent = join(ROOT, pattern.slice(0, -2));

      if (!existsSync(parent)) {
        continue;
      }

      for (const name of readdirSync(parent)) {
        const d = join(parent, name);

        if (statSync(d).isDirectory() && existsSync(join(d, "package.json"))) {
          dirs.add(d);
        }
      }
    } else if (existsSync(join(ROOT, pattern, "package.json"))) {
      dirs.add(join(ROOT, pattern));
    }
  }

  return [...dirs];
}

/** main / types / exports / bin — the surface only a CONSUMER ever reads. */
function checkManifest(pkgDir) {
  const manifestPath = join(pkgDir, "package.json");
  const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rel = manifestPath.slice(ROOT.length + 1);

  // No dist at all means this package was not built (some bundle with their own
  // toolchain). "Not built" and "declared wrong" must not look the same, so say
  // which one it is rather than reporting every path as broken.
  if (!existsSync(join(pkgDir, "dist"))) {
    skipped.push(rel);

    return;
  }

  const targets = [];

  if (pkg.main) {
    targets.push(["main", pkg.main]);
  }

  if (pkg.types) {
    targets.push(["types", pkg.types]);
  }

  if (typeof pkg.bin === "string") {
    targets.push(["bin", pkg.bin]);
  } else {
    for (const [key, value] of Object.entries(pkg.bin ?? {})) {
      targets.push([`bin.${key}`, value]);
    }
  }

  for (const [subpath, value] of Object.entries(pkg.exports ?? {})) {
    const entries = typeof value === "string" ? { default: value } : value;

    for (const [cond, target] of Object.entries(entries)) {
      if (typeof target === "string") {
        targets.push([`exports["${subpath}"].${cond}`, target]);
      }
    }
  }

  // package.json is excluded from the file scan below, so the scripts that run
  // compiled entry points are only reachable here.
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    for (const m of script.matchAll(
      /(?:^|[\s"'/])(dist\/[\w./-]+\.(?:js|cjs|mjs))/g,
    )) {
      targets.push([`scripts.${name}`, m[1]]);
    }
  }

  for (const [field, target] of targets) {
    // A wildcard names a shape, not a file: check the directory it lives in.
    const probe = target.includes("*") ? probeDir(target) : target;

    if (!existsSync(join(pkgDir, probe))) {
      note(rel, `${field} → ${target}  (no such path — did a rename move it?)`);
    }
  }
}

/** Any compiled path spelled out in a chart, Dockerfile, workflow or script.
 *
 * Deliberately NOT anchored to `node <path>`: the Helm CronJob writes
 * `["node", "dist/transport/job-runner.js"]` in JSON-array form, and an
 * anchored pattern walked straight past it — a green run that proved nothing.
 * Matching the path itself covers every spelling: array form, an `exec` shim,
 * a bare npm script. */
const COMPILED_PATH = /(?:^|[\s"'\/])(dist\/[\w./-]+\.(?:js|cjs|mjs))/g;

function checkInvocations(file, pkgDirs) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1);

  for (const m of text.matchAll(COMPILED_PATH)) {
    const distPath = m[1];
    // The command does not say which package it runs in, so accept it if ANY
    // workspace produces that path — a stale one matches nowhere.
    const found = pkgDirs.some((d) => existsSync(join(d, distPath)));

    if (!found) {
      note(rel, `${distPath}  (no workspace builds that path)`);
    }
  }
}

/** Source paths declared in a vitest config: coverage `include`, mostly.
 *
 * A stale one does NOT error — coverage simply measures nothing and reports
 * 0/0, which passes. Four packages carried one of these through the tier
 * migration, including a gate naming a file that has never existed. */
function checkVitestConfig(pkgDir) {
  const config = join(pkgDir, "vitest.config.ts");

  if (!existsSync(config)) {
    return;
  }

  const rel = config.slice(ROOT.length + 1);
  const text = readFileSync(config, "utf8");

  // Only `coverage.include`: a stale `exclude` names something already absent,
  // which is harmless. An include that names nothing measures nothing and passes.
  const includeBlock = text.match(/include:\s*\[([\s\S]*?)\]/);

  if (!includeBlock) {
    return;
  }

  for (const m of includeBlock[1].matchAll(/["'](src\/[\w./*-]+)["']/g)) {
    const declared = m[1];
    // A glob names a shape; check the fixed directory part instead.
    const probe = declared.includes("*") ? probeDir(declared) : declared;

    if (!existsSync(join(pkgDir, probe))) {
      note(
        rel,
        `${declared}  (no such source path — coverage would measure nothing)`,
      );
    }
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", "dist", ".next"].includes(name)) {
      continue;
    }
    const p = join(dir, name);
    const st = statSync(p);

    if (st.isDirectory()) {
      walk(p, out);
    } else {
      out.push(p);
    }
  }

  return out;
}

const pkgDirs = workspacePackages();

for (const d of pkgDirs) {
  checkManifest(d);
  checkVitestConfig(d);
}

const scanned = ["infra", "charts", "apps", "libs", ".github", "scripts"]
  .map((d) => join(ROOT, d))
  .filter(existsSync)
  .flatMap((d) => walk(d))
  // package.json is excluded: checkManifest already reads those fields, and it
  // knows to skip a package that was never built.
  .filter((f) => /Dockerfile|\.(ya?ml|sh|json)$/.test(f))
  .filter(
    (f) => !f.endsWith("package.json") && !f.endsWith("package-lock.json"),
  );

for (const f of scanned) {
  checkInvocations(f, pkgDirs);
}

// A workflow that names a test file by path runs NOTHING when that path moves.
for (const f of scanned.filter((x) => x.includes("/.github/workflows/"))) {
  const rel = f.slice(ROOT.length + 1);
  const text = readFileSync(f, "utf8");

  for (const m of text.matchAll(/(?:^|\s)(src\/[\w./-]+\.(?:ts|tsx|mjs))/gm)) {
    const declared = m[1];
    const found =
      pkgDirs.some((d) => existsSync(join(d, declared))) ||
      existsSync(join(ROOT, declared));

    if (!found) {
      note(rel, `${declared}  (no workspace holds that source file)`);
    }
  }
}

if (problems.length) {
  console.error(
    `\n[declared-paths] ${problems.length} declared path(s) do not resolve:\n`,
  );

  for (const p of problems) {
    console.error(`  ${p}\n`);
  }
  console.error(
    "These are read by consumers, Kubernetes and CI — never by tsc, so a\n" +
      "package can build clean and still be unloadable. Build first, then fix\n" +
      "the declaration to match where the file actually landed.\n",
  );
  process.exit(1);
}

console.log(
  `[declared-paths] ${pkgDirs.length - skipped.length} manifests and ${scanned.length} files — every declared path resolves`,
);

for (const s of skipped) {
  console.log(
    `[declared-paths] skipped ${s} — no dist/, so nothing to check against`,
  );
}
