/**
 * Parser + resolver for the per-repo test-command manifest — the optional
 * `.lore/test-commands.yml` file (or `lore.repos.settings.test_commands`)
 * that declares the project's own `list`/`run` commands so Lore discovers
 * tests and per-test coverage through the repo's runner instead of
 * guessing. Supports a polyglot array (one entry per package) and lets
 * settings win over the file. See
 * `specs/project-test-interface/contracts/test-commands.md`.
 */

export type CoverageFormat = "lcov" | "cobertura" | "json";

export interface TestCommandManifest {
  list?: string;
  run: string;
  coverage_format?: CoverageFormat;
  cwd: string;
  path_prefix_strip: string;
}

export function parseTestCommandManifest(raw: unknown): TestCommandManifest[] {
  const entries = Array.isArray(raw) ? raw : [raw];

  return entries
    .map(normalizeEntry)
    .filter((entry): entry is TestCommandManifest => entry !== null);
}

/**
 * Resolve the manifest from its two declaration sites. Repo settings
 * (`lore.repos.settings.test_commands`) win over the `.lore/test-commands.yml`
 * file; returns null when neither declares one (fallback to pattern detection).
 */
export function resolveTestCommandManifest(sources: {
  settings?: unknown;
  file?: unknown;
}): TestCommandManifest[] | null {
  if (!isManifestDeclared(sources)) {
    return null;
  }

  return parseTestCommandManifest(sources.settings ?? sources.file);
}

/** True when either declaration site supplies a manifest (file or settings non-null). */
export function isManifestDeclared(sources: {
  file?: unknown;
  settings?: unknown;
}): boolean {
  return (sources.settings ?? sources.file) != null;
}

export type TestInterfaceCheck =
  { status: "configured" } | { status: "scaffold"; files: string[] };

/**
 * Onboard-time decision: a repo with no declared test-command manifest gets
 * both interface files scaffolded; otherwise it is already configured.
 */
export function decideTestInterfaceCheck(sources: {
  manifestFileDeclared: boolean;
  settingsTestCommands?: unknown;
}): TestInterfaceCheck {
  const declared =
    sources.manifestFileDeclared ||
    isManifestDeclared({ settings: sources.settingsTestCommands });

  if (declared) {
    return { status: "configured" };
  }

  return {
    status: "scaffold",
    files: [".lore/test-commands.yml", ".github/workflows/lore-tests.yml"],
  };
}

/** Substitute the runner-native test id into a `run` command's {selector} placeholder. */
export function substituteSelector(run: string, selector: string): string {
  return run.replaceAll("{selector}", selector);
}

const COVERAGE_FORMATS: readonly CoverageFormat[] = [
  "lcov",
  "cobertura",
  "json",
];

/**
 * Normalize one raw entry, or drop it (return null) when it is unusable. The
 * only irreducible requirement is a non-empty `run` — a whole-suite entry that
 * runs whole (no per-test `list`, no `{selector}`, no coverage) is honest, not
 * malformed, so one such entry must never take a valid sibling down with it.
 * `list`/`coverage_format` are optional; an unknown coverage_format is ignored
 * rather than dropping the runnable entry.
 */
function normalizeEntry(raw: unknown): TestCommandManifest | null {
  const entry = (raw ?? {}) as Record<string, unknown>;

  if (typeof entry.run !== "string" || entry.run.trim() === "") {
    return null;
  }

  const list =
    typeof entry.list === "string" && entry.list.trim() !== ""
      ? entry.list
      : undefined;

  return {
    list,
    run: entry.run,
    coverage_format: COVERAGE_FORMATS.includes(
      entry.coverage_format as CoverageFormat,
    )
      ? (entry.coverage_format as CoverageFormat)
      : undefined,
    cwd: typeof entry.cwd === "string" ? entry.cwd : ".",
    path_prefix_strip:
      typeof entry.path_prefix_strip === "string"
        ? entry.path_prefix_strip
        : "",
  };
}
