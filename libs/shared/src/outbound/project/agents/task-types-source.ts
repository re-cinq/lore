import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

/** The text of a `task-types.yaml` and every `task-types.<name>.yaml` beside it, as one multi-document stream in file-name order — the shape `parseTaskTypesFile` reads and the ConfigMap ships. Throws when the main file is missing, so a loader moves on to its next candidate path. */
export function readTaskTypesSource(path: string): string {
  const main = readFileSync(path, "utf-8");

  return [main, ...siblingPaths(path).map((p) => readFileSync(p, "utf-8"))].join(
    "\n---\n",
  );
}

function siblingPaths(path: string): string[] {
  const directory = dirname(path);
  const stem = basename(path, extname(path));
  const fragment = new RegExp(`^${stem.replace(/[.]/g, "\\.")}\\.[^.]+\\.ya?ml$`);

  return readdirSync(directory)
    .filter((name) => fragment.test(name))
    .sort()
    .map((name) => join(directory, name));
}
