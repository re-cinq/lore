/**
 * spec-traceability-graph — feature-folder grouping.
 *
 * A speckit "feature" is one folder under `specs/` whose many `.md` files
 * (spec.md, plan.md, data-model.md, contracts/*, …) describe the same unit of
 * work. `featureDirOf` maps a spec file's path to that owning folder so every doc
 * in `specs/5-lore-agent/` collapses onto one `Feature` node in the graph:
 *   - `specs/<feature>/…` (any depth) → `specs/<feature>`,
 *   - any other directory (e.g. `.specify/spec.md`) → its immediate directory,
 *   - a repo-root file with no directory → null (no feature).
 */
export function featureDirOf(filePath: string): string | null {
  const segments = filePath.split("/");

  if (segments.length < 2) {
    return null;
  }

  if (segments[0] === "specs") {
    return `specs/${segments[1]}`;
  }

  return segments.slice(0, -1).join("/");
}
