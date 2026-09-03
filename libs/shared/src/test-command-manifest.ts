/** Per-repo test-command manifest (.lore/test-commands.yml or settings); declares list/run for test discovery. */

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

/** Resolve manifest from settings (win) or .lore/test-commands.yml file; null → pattern detection fallback. */
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

/** Onboard-time: scaffold interface files if no manifest declared; otherwise already configured. */
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

/** Normalize entry; non-empty `run` is irreducible; `list` and `coverage_format` optional. */
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
