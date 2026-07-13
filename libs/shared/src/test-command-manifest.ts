import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
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
  list: string;
  run: string;
  coverage_format: CoverageFormat;
  cwd: string;
  path_prefix_strip: string;
}

export function parseTestCommandManifest(raw: unknown): TestCommandManifest[] {
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries.map(normalizeEntry);
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
  if (!isManifestDeclared(sources)) return null;
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
  if (declared) return { status: "configured" };
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

function normalizeEntry(raw: unknown): TestCommandManifest {
  const entry = (raw ?? {}) as Record<string, unknown>;

  enforceTrue(
    !(typeof entry.list !== "string" || entry.list.trim() === ""),
    new Error("test-command manifest: 'list' command is required"),
  );
  enforceTrue(
    !(typeof entry.run !== "string" || entry.run.trim() === ""),
    new Error("test-command manifest: 'run' command is required"),
  );
  enforceTrue(
    entry.run.includes("{selector}"),
    new Error(
      "test-command manifest: 'run' must contain the {selector} placeholder",
    ),
  );
  enforceTrue(
    COVERAGE_FORMATS.includes(entry.coverage_format as CoverageFormat),
    new Error(
      `test-command manifest: 'coverage_format' must be one of ${COVERAGE_FORMATS.join(", ")}`,
    ),
  );

  return {
    list: entry.list,
    run: entry.run,
    coverage_format: entry.coverage_format as CoverageFormat,
    cwd: typeof entry.cwd === "string" ? entry.cwd : ".",
    path_prefix_strip:
      typeof entry.path_prefix_strip === "string"
        ? entry.path_prefix_strip
        : "",
  };
}
