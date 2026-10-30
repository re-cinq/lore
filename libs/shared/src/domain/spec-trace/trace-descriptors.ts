import type { TestDescriptor } from "../test-report.js";

type RunnerLocation = { readonly line: number; readonly column: number };
type ExecutionStatus = "passed" | "failed" | "skipped" | "pending" | "unknown";

type SuiteSnapshot = {
  readonly type: "suite" | "module";
  readonly name: string;
  readonly parent?: SuiteSnapshot;
  errors(): readonly unknown[];
};

type CaseSnapshot = {
  readonly id: string;
  readonly fullName: string;
  readonly project: { readonly name: string };
  readonly parent: SuiteSnapshot;
  readonly location?: RunnerLocation;
  readonly options: { readonly fails?: boolean };
  result(): { readonly state: Exclude<ExecutionStatus, "unknown"> };
};

export type VitestModuleSnapshot = {
  readonly moduleId: string;
  readonly children: { allTests(): Iterable<CaseSnapshot> };
  errors(): readonly unknown[];
};

type RunnerDescriptor = TestDescriptor & {
  runnerId: string;
  execution: {
    status: ExecutionStatus;
    location?: RunnerLocation;
    expectedFailure: boolean;
    fileCaseCount?: number;
  };
};

type SnapshotOptions = {
  pkg: string;
  executed: boolean;
  unhandledErrors?: readonly unknown[];
};

export function descriptorsFromVitestModules(
  modules: readonly VitestModuleSnapshot[],
  options: SnapshotOptions,
): RunnerDescriptor[] {
  const descriptors = modules.flatMap((module) =>
    moduleDescriptors(module, options),
  );
  const counts = new Map<string, number>();

  for (const descriptor of descriptors) {
    counts.set(descriptor.file, (counts.get(descriptor.file) ?? 0) + 1);
  }

  return descriptors.map((descriptor) => ({
    ...descriptor,
    execution: {
      ...descriptor.execution,
      fileCaseCount: counts.get(descriptor.file)!,
    },
  }));
}

function moduleDescriptors(
  module: VitestModuleSnapshot,
  options: SnapshotOptions,
): RunnerDescriptor[] {
  const file = repoRelative(module.moduleId, options.pkg);

  if (!file.startsWith(`${options.pkg}/src/`)) {
    return [];
  }
  const recorded =
    options.executed &&
    !options.unhandledErrors?.length &&
    module.errors().length === 0;

  return [...module.children.allTests()].map((test) =>
    nativeDescriptor(file, test, { recorded }),
  );
}

function nativeDescriptor(
  file: string,
  test: CaseSnapshot,
  options: { recorded: boolean },
): RunnerDescriptor {
  const suites = parentSuites(test.parent);
  const suite = suites.map((parent) => parent.name);
  const location = validLocation(test.location);

  return {
    id: `${file}::${test.fullName}`,
    name: test.fullName,
    file,
    ...(suite.length ? { suite } : {}),
    ...(location ? { startLine: location.line } : {}),
    runnerId: JSON.stringify([file, test.project.name, test.id]),
    execution: executionSnapshot(test, { ...options, suites, location }),
  };
}

function executionSnapshot(
  test: CaseSnapshot,
  options: {
    recorded: boolean;
    suites: SuiteSnapshot[];
    location?: RunnerLocation;
  },
): RunnerDescriptor["execution"] {
  return {
    status:
      options.recorded &&
      options.suites.every((parent) => parent.errors().length === 0)
        ? test.result().state
        : "unknown",
    ...(options.location ? { location: options.location } : {}),
    expectedFailure: test.options.fails === true,
  };
}

function parentSuites(parent: SuiteSnapshot): SuiteSnapshot[] {
  if (parent.type === "module") {
    return [];
  }

  return [...(parent.parent ? parentSuites(parent.parent) : []), parent];
}

function validLocation(
  location: RunnerLocation | undefined,
): RunnerLocation | undefined {
  return location &&
    positiveInteger(location.line) &&
    positiveInteger(location.column)
    ? { line: location.line, column: location.column }
    : undefined;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** One raw `vitest list --json` entry. */
export interface VitestListEntry {
  name: string;
  file: string;
}

/** Maps `vitest list` entries to per-`it` descriptors: ` > `-joined name splits into `suite` + leaf `it`, `id` is `${file}::${name}`; entries outside `${pkg}/src/` (e.g. stale `dist/`) are dropped. */
export function descriptorsFromVitestList(
  entries: VitestListEntry[],
  options: { pkg: string },
): TestDescriptor[] {
  const descriptors: TestDescriptor[] = [];

  for (const entry of entries) {
    const descriptor = descriptorForEntry(entry, options.pkg);

    if (descriptor) {
      descriptors.push(descriptor);
    }
  }

  return descriptors;
}

/** One descriptor for a `vitest list` entry, or null when it lives outside `${pkg}/src/` (e.g. stale `dist/`). */
function descriptorForEntry(
  entry: VitestListEntry,
  pkg: string,
): TestDescriptor | null {
  const file = repoRelative(entry.file, pkg);

  if (!file.startsWith(`${pkg}/src/`)) {
    return null;
  }
  const segments = entry.name.split(" > ");
  const suite = segments.slice(0, -1);

  return {
    id: `${file}::${entry.name}`,
    name: entry.name,
    file,
    ...(suite.length > 0 ? { suite } : {}),
  };
}

/** Repo-relative POSIX path: the substring from the last `/<pkg>/` marker onward. */
function repoRelative(absolutePath: string, pkg: string): string {
  const marker = `/${pkg}/`;
  const at = absolutePath.indexOf(marker);

  return at === -1 ? absolutePath : absolutePath.slice(at + 1);
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
