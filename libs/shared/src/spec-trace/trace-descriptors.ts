/**
 * spec-traceability-graph — pure transforms between `vitest list --json` output
 * and the project-test-interface's TestDescriptor shape. Extracted from the
 * `scripts/trace/*.mjs` glue so the per-`it` logic is unit-testable without
 * spawning vitest. `vitest list --json` emits one entry per `it()` as
 * `{ name: "<describe> > <it>", file: "<abs path>" }`; we keep that per-`it`
 * granularity (the describe chain becomes `suite[]`) instead of collapsing to one
 * descriptor per file.
 */

import type { TestDescriptor } from "../test-report.js";

/** One raw `vitest list --json` entry. */
export interface VitestListEntry {
  name: string;
  file: string;
}

/** Repo-relative POSIX path: the substring from the last `/<pkg>/` marker onward. */
function repoRelative(absolutePath: string, pkg: string): string {
  const marker = `/${pkg}/`;
  const at = absolutePath.indexOf(marker);
  return at === -1 ? absolutePath : absolutePath.slice(at + 1);
}

/**
 * Maps `vitest list` entries to per-`it` descriptors. The ` > `-joined name is
 * split into `suite` (the describe ancestors) + the leaf `it`; `id` is
 * `${file}::${name}` (unique per `it`, file recoverable). Entries outside
 * `${pkg}/src/` (e.g. stale `dist/` copies) are dropped.
 */
export function descriptorsFromVitestList(
  entries: VitestListEntry[],
  options: { pkg: string },
): TestDescriptor[] {
  const { pkg } = options;
  const descriptors: TestDescriptor[] = [];
  for (const entry of entries) {
    const file = repoRelative(entry.file, pkg);
    if (!file.startsWith(`${pkg}/src/`)) continue;
    const segments = entry.name.split(" > ");
    const suite = segments.slice(0, -1);
    descriptors.push({
      id: `${file}::${entry.name}`,
      name: entry.name,
      file,
      ...(suite.length > 0 ? { suite } : {}),
    });
  }
  return descriptors;
}

/**
 * Groups descriptor ids by their `file`, in first-appearance order, so the
 * orchestrators run `run` ONCE per file (coverage is file-level) and fan the
 * result back to every descriptor sharing that file.
 */
export function groupRunsByFile(
  descriptors: TestDescriptor[],
): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const descriptor of descriptors) {
    (
      byFile.get(descriptor.file) ??
      byFile.set(descriptor.file, []).get(descriptor.file)!
    ).push(descriptor.id);
  }
  return byFile;
}
