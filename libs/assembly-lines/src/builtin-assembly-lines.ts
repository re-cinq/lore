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

export function loadBuiltinAssemblyLines(): Promise<Map<string, AssemblyLine>> {
  return loadAssemblyLineDir(ASSEMBLY_LINES_DIR);
}
