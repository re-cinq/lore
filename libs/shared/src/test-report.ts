import { enforceTrue } from "./lib/enforce.js";
/** Parsers for the project's test-command output (`specs/project-test-interface/contracts/test-commands.md`): `parseTestDescriptors` turns `tests.list` stdout into {@link TestDescriptor}s, `parseRunResult` turns `tests.run <id>` stdout into a {@link RunResult}. */

export interface TestDescriptor {
  id: string;
  name: string;
  file: string;
  startLine?: number;
  endLine?: number;
  suite?: string[];
  /** One `path#ordinal` spec anchor, or several when one test validates several statements. */
  spec?: string | string[];
  passed?: boolean;
}

export interface CoveredChunk {
  file: string;
  startLine: number;
  endLine: number;
}

export interface RunResult {
  passed: boolean;
  covered: CoveredChunk[];
}

// A `tests.run` result tagged with the descriptor `id` it belongs to (the join key for `test-report`).
export type TaggedRunResult = RunResult & { id: string };

/** A string array, or undefined when `value` isn't one made entirely of strings. */
function stringArrayOrUndefined(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? (value as string[])
    : undefined;
}

/** The `spec` field: a single anchor string, a string array of them, or undefined for anything else. */
function normalizeSpecField(spec: unknown): string | string[] | undefined {
  return typeof spec === "string" ? spec : stringArrayOrUndefined(spec);
}

function buildTestDescriptor(entry: Record<string, unknown>): TestDescriptor {
  const descriptor: TestDescriptor = {
    id: requireString(entry, "id", "test descriptor"),
    name: requireString(entry, "name", "test descriptor"),
    file: requireString(entry, "file", "test descriptor"),
  };

  if (typeof entry.startLine === "number") {
    descriptor.startLine = entry.startLine;
  }

  if (typeof entry.endLine === "number") {
    descriptor.endLine = entry.endLine;
  }

  descriptor.suite = stringArrayOrUndefined(entry.suite);
  descriptor.spec = normalizeSpecField(entry.spec);

  if (typeof entry.passed === "boolean") {
    descriptor.passed = entry.passed;
  }

  return descriptor;
}

export function parseTestDescriptors(raw: unknown): TestDescriptor[] {
  return asArray(raw, "test descriptors").map(buildTestDescriptor);
}

export function parseRunResult(raw: unknown): RunResult {
  const entry = (raw ?? {}) as Record<string, unknown>;

  return {
    passed: entry.passed === true,
    covered: parseCoveredChunks(entry.covered),
  };
}

function parseCoveredChunks(raw: unknown): CoveredChunk[] {
  return asArray(raw, "covered chunks").map((entry) => ({
    file: requireString(entry, "file", "covered chunk"),
    startLine: requireNumber(entry, "startLine", "covered chunk"),
    endLine: requireNumber(entry, "endLine", "covered chunk"),
  }));
}

function asArray(raw: unknown, what: string): Record<string, unknown>[] {
  enforceTrue(Array.isArray(raw), Error, `${what}: expected an array`);

  return raw as Record<string, unknown>[];
}

function requireString(
  entry: Record<string, unknown>,
  field: string,
  what: string,
): string {
  const value = entry[field];

  enforceTrue(
    !(typeof value !== "string" || value === ""),
    Error,
    `${what}: '${field}' is required`,
  );

  return value;
}

function requireNumber(
  entry: Record<string, unknown>,
  field: string,
  what: string,
): number {
  const value = entry[field];

  enforceTrue(
    typeof value === "number",
    Error,
    `${what}: '${field}' is required`,
  );

  return value;
}
