#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const selector = process.argv[2];

if (!selector) {
  console.error("run-test: missing test id");
  process.exit(2);
}
const file = selector.split("::")[0];
const pkg = file.split("/").slice(0, 2).join("/");
const directory = mkdtempSync(join(tmpdir(), "lore-trace-one-"));
const filesPath = join(directory, "files.json");
const outputPath = join(directory, "out.json");
const worker = join(
  dirname(fileURLToPath(import.meta.url)),
  "trace-worker.mjs",
);

try {
  writeFileSync(filesPath, JSON.stringify([file]));
  writeFileSync(outputPath, "{}");
  const child = spawnSync(
    process.execPath,
    [worker, root, pkg, filesPath, outputPath],
    {
      cwd: join(root, pkg),
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  const results = JSON.parse(readFileSync(outputPath, "utf8"));

  if (child.error) {
    throw child.error;
  }
  process.stdout.write(
    JSON.stringify(results[file] ?? { passed: false, covered: [], tests: [] }),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
