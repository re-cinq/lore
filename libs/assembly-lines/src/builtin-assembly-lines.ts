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
 * Load the bundled definitions. Goal-gate bypass warnings surface through
 * `onWarning`, defaulting to `console.warn` so a bypassable gate is visible
 * at server startup rather than silently swallowed (specs/goal-gates FR1).
 */
export function loadBuiltinAssemblyLines(
  onWarning: (warning: string) => void = (warning) =>
    console.warn(`[assembly-lines] ${warning}`),
): Promise<Map<string, AssemblyLine>> {
  return loadAssemblyLineDir(ASSEMBLY_LINES_DIR, onWarning);
}
