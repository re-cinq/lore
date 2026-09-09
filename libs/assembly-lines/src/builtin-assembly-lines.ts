import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssemblyLineDir, type AssemblyLine } from "./loader.js";

// The assembly line YAMLs shipped inside this package, copied to `dist/assembly-lines/` by the build; resolved relative to the compiled module so the kernel finds them regardless of cwd.
const ASSEMBLY_LINES_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "assembly-lines",
);

// Caches the promise (not just the value) so concurrent first callers collapse to one load, but never caches a rejection — a transient I/O error would otherwise fail every caller for the process's lifetime.
export function memoizedPromise<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;

  return () => {
    if (!cached) {
      cached = load().catch((err: unknown) => {
        cached = undefined;
        throw err;
      });
    }

    return cached;
  };
}

// Memoized: the dir is baked into the image (immutable per process) — the Floor's node-terminal path used to re-read/re-parse it on every event. This is the ONE cache; callers must not wrap their own.
export const loadBuiltinAssemblyLines: () => Promise<
  Map<string, AssemblyLine>
> = memoizedPromise(() => loadAssemblyLineDir(ASSEMBLY_LINES_DIR));
