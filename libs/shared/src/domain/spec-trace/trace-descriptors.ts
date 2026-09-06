/** Pure transforms between `vitest list --json` output and the project-test-interface's TestDescriptor shape, extracted from `scripts/trace/*.mjs` so per-`it` logic is unit-testable without spawning vitest; keeps per-`it` granularity (describe chain becomes `suite[]`). */

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

/** Maps `vitest list` entries to per-`it` descriptors: ` > `-joined name splits into `suite` + leaf `it`, `id` is `${file}::${name}`; entries outside `${pkg}/src/` (e.g. stale `dist/`) are dropped. */
export function descriptorsFromVitestList(
  entries: VitestListEntry[],
  options: { pkg: string },
): TestDescriptor[] {
  const { pkg } = options;
  const descriptors: TestDescriptor[] = [];

  for (const entry of entries) {
    const file = repoRelative(entry.file, pkg);

    if (!file.startsWith(`${pkg}/src/`)) {
      continue;
    }
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

/** Groups descriptor ids by `file`, first-appearance order, so orchestrators run `run` once per file (coverage is file-level) and fan the result back to every descriptor sharing it. */
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
