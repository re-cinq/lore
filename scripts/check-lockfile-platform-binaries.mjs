#!/usr/bin/env node
// Fail when package-lock.json stops listing a TypeScript 7 platform binary the
// root package.json declares, or lists it at a version no workspace runs.
//
// TypeScript 7 is a launcher plus one native binary per platform, shipped as
// optional dependencies. The workspaces pin `typescript@^7` while the root keeps
// an older one for typescript-eslint, so npm nests TypeScript 7 under every
// workspace — and npm's lockfile rewrite (npm/cli#4828) drops the platform
// binaries of nested packages, keeping only the writing machine's. On 2026-08-25
// a Linux regeneration in #1500 left `linux-x64` alone; CI (linux-x64) stayed
// green for two weeks while every fresh Mac checkout died in `tsc` with
// "Unable to resolve @typescript/typescript-darwin-arm64". #1827 moved the
// binaries to root optionalDependencies so npm resolves them reliably; this is
// the guard that fails the next regeneration on the spot.
//
// The launcher resolves its binary by package name with no version check, so a
// binary at the wrong version runs silently. Hence the second rule.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(import.meta.dirname, "..");

const BINARY_PREFIX = "@typescript/typescript-";

/** Every complaint the guard has about this package.json + lockfile pair;
 *  empty means the lockfile is sound. */
export function platformBinaryFindings({ pkg, lock }) {
  const declared = Object.keys(pkg.optionalDependencies ?? {}).filter((name) =>
    name.startsWith(BINARY_PREFIX),
  );

  if (declared.length === 0) {
    return [
      `package.json declares no ${BINARY_PREFIX}* optionalDependencies; the guard has nothing to check`,
    ];
  }

  const packages = lock.packages ?? {};
  const workspaceTypescripts = Object.entries(packages).filter(
    ([path, entry]) =>
      path !== "node_modules/typescript" &&
      path.endsWith("/node_modules/typescript") &&
      entry.version !== undefined,
  );

  return declared.flatMap((name) => {
    const entry = packages[`node_modules/${name}`];

    if (entry === undefined) {
      return [
        `${name} is declared in package.json but has no entry in package-lock.json`,
      ];
    }

    return workspaceTypescripts
      .filter(([, ts]) => ts.version !== entry.version)
      .map(
        ([path, ts]) =>
          `${name} resolves to ${entry.version} but ${path} is ${ts.version}`,
      );
  });
}

const readJson = (file) =>
  JSON.parse(readFileSync(join(repoRoot, file), "utf8"));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = platformBinaryFindings({
    pkg: readJson("package.json"),
    lock: readJson("package-lock.json"),
  });

  if (findings.length > 0) {
    console.error(
      "ERROR: package-lock.json does not carry the TypeScript platform binaries\n" +
        "package.json declares. A fresh `npm ci` on the missing platform installs\n" +
        "TypeScript 7 with no compiler and every `tsc` build fails.\n",
    );

    for (const finding of findings) {
      console.error(`  ${finding}`);
    }
    console.error(
      "\nDo not regenerate the lockfile from scratch (that is what drops them).\n" +
        "Run `npm install` on the current lockfile and commit the result.",
    );
    process.exit(1);
  }

  console.log(
    `[lore] package-lock.json lists every declared TypeScript platform binary at the workspaces' version`,
  );
}
