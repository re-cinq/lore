import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { shippedCatalog } from "./production-pack-deps.js";
import { isPackFile } from "./pack-paths.js";
import { packOverlay, type PackOverlay } from "./pack-loader.js";
import type { PackFile } from "./fetch-pack.js";

/** Stands in for the install's environment: whether a variable is set there is not the pack's to know. */
const ANY_ENVIRONMENT_VARIABLE = new Proxy<Record<string, string | undefined>>(
  {},
  { get: (_variables, name) => `${String(name)}-for-lint` },
);

const USAGE = "usage: pack-lint <pack directory>";

/** The same overlay an apply computes from the pack, run on a local directory: no floor, no network. */
export async function lintPackDirectory(root: string): Promise<PackOverlay> {
  return packOverlay({
    files: await packFilesIn(root),
    shipped: await shippedCatalog(),
    env: ANY_ENVIRONMENT_VARIABLE,
  });
}

/** Prints the refused files and answers the exit code: 0 clean, 1 refused, 2 misuse. */
export async function packLintMain(
  args: string[],
  print: (line: string) => void,
): Promise<number> {
  const [root] = args;

  if (!root) {
    print(USAGE);

    return 2;
  }

  const { refused, counts } = await lintPackDirectory(root);

  for (const { path, reason } of refused) {
    print(`${path}: ${reason}`);
  }

  if (refused.length > 0) {
    return 1;
  }

  print(summaryOf(counts));

  return 0;
}

function summaryOf(counts: PackOverlay["counts"]): string {
  return `pack ok: ${counts.agents} agents, ${counts.pipelines} pipelines, ${counts.extensions} extensions`;
}

async function packFilesIn(root: string): Promise<PackFile[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length)
        .replace(/^[\\/]+/, "")
        .split("\\")
        .join("/"),
    )
    .filter((path) => isPackFile(path) && !path.startsWith(".git/"));

  return Promise.all(
    paths.map(async (path) => ({
      path,
      text: await readFile(join(root, path), "utf8"),
    })),
  );
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = await packLintMain(process.argv.slice(2), console.log);
}
