import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssemblyLineDir, type AssemblyLine } from "./loader.js";

/**
 * The assembly line YAMLs that ship inside this package (gap-fill, general,
 * implementation), copied to `dist/assembly-lines/` by the build. Resolved relative
 * to the compiled module so the kernel finds them regardless of cwd — both the
 * in-agent path and the pod entry use this instead of hand-rolling a path.
 */
const ASSEMBLY_LINES_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "assembly-lines",
);

/**
 * Cache the promise, not just the value, so concurrent first callers collapse to
 * one load — but never cache a rejection: a transient I/O error at first call
 * would otherwise fail every caller for the process's lifetime.
 */
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

/**
 * Memoized: the dir is baked into the image and immutable per process, and the
 * Floor's node-terminal path used to re-read and re-parse it on every event.
 * This is the ONE cache — callers must not wrap their own around it.
 */
export const loadBuiltinAssemblyLines: () => Promise<
  Map<string, AssemblyLine>
> = memoizedPromise(() => loadAssemblyLineDir(ASSEMBLY_LINES_DIR));
