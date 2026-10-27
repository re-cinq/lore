#!/usr/bin/env node
// Lore test-command interface -- `run_many`. Reads repo-relative test files on
// stdin, one per line, and prints {file: {passed, covered}} for every file it
// ran, the shape `run` prints for one. The files are split into chunks per
// package and each chunk runs in one trace-worker.mjs (one vitest), several at
// a time. A chunk whose worker dies leaves its files to run-test.mjs, one by
// one, so a crash costs time and not the report.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd(); // manifest cwd == repo root
const HERE = fileURLToPath(new URL(".", import.meta.url));
const SLOTS = Number(process.env.LORE_TRACE_WORKERS) || availableParallelism();

function packageOf(file) {
  return file.split("/").slice(0, 2).join("/");
}

// Each package gets chunks in proportion to its share of the files, so a big
// package spreads over the slots and a small one costs a single boot.
function chunksOf(files) {
  const byPackage = Map.groupBy(files, packageOf);

  return [...byPackage].flatMap(([pkg, pkgFiles]) => {
    const count = Math.max(
      1,
      Math.round((SLOTS * pkgFiles.length) / files.length),
    );
    const size = Math.ceil(pkgFiles.length / count);

    return Array.from(
      { length: Math.ceil(pkgFiles.length / size) },
      (_, i) => ({
        pkg,
        files: pkgFiles.slice(i * size, (i + 1) * size),
      }),
    );
  });
}

function run(command, args, cwd = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

async function runChunk(chunk, dir, index) {
  const filesPath = join(dir, `files-${index}.json`);
  const outPath = join(dir, `out-${index}.json`);

  writeFileSync(filesPath, JSON.stringify(chunk.files));
  writeFileSync(outPath, "{}");
  const { code } = await run(
    process.execPath,
    [join(HERE, "trace-worker.mjs"), ROOT, chunk.pkg, filesPath, outPath],
    join(ROOT, chunk.pkg),
  );
  const answered = JSON.parse(readFileSync(outPath, "utf-8"));

  if (code !== 0) {
    console.error(
      `[trace] run_many: the ${chunk.pkg} worker exited ${code}; running its unanswered files one by one`,
    );

    for (const file of chunk.files.filter((f) => !(f in answered))) {
      const one = await run(process.execPath, [
        join(HERE, "run-test.mjs"),
        file,
      ]);

      if (one.code === 0) {
        answered[file] = JSON.parse(one.stdout);
      }
    }
  }

  return answered;
}

const files = readFileSync(0, "utf-8").split("\n").filter(Boolean);
const chunks = chunksOf(files);
const dir = mkdtempSync(join(tmpdir(), "lore-trace-many-"));
const results = {};

try {
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(SLOTS, chunks.length) }, async () => {
      while (next < chunks.length) {
        const index = next++;

        Object.assign(results, await runChunk(chunks[index], dir, index));
      }
    }),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify(results));
