import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/**
 * Parsers for the deterministic, zero-LLM output of the project's test
 * commands: `parseTestDescriptors` turns `tests.list` stdout into
 * {@link TestDescriptor}s (one per test, seeding `TestChunk`), and
 * `parseRunResult` turns `tests.run <id>` stdout into a {@link RunResult}
 * (`passed` + covered {@link CoveredChunk}s). The covered-chunk shape is
 * identical across `tests.run`, the `test-report` `covered[]`, and the
 * bulk `/coverage` body. See
 * `specs/project-test-interface/contracts/test-commands.md`.
 */

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

export function parseTestDescriptors(raw: unknown): TestDescriptor[] {
  return asArray(raw, "test descriptors").map((entry) => {
    const descriptor: TestDescriptor = {
      id: requireString(entry, "id", "test descriptor"),
      name: requireString(entry, "name", "test descriptor"),
      file: requireString(entry, "file", "test descriptor"),
    };
    if (typeof entry.startLine === "number")
      descriptor.startLine = entry.startLine;
    if (typeof entry.endLine === "number") descriptor.endLine = entry.endLine;
    if (
      Array.isArray(entry.suite) &&
      entry.suite.every((s) => typeof s === "string")
    )
      descriptor.suite = entry.suite as string[];
    if (typeof entry.spec === "string") descriptor.spec = entry.spec;
    else if (
      Array.isArray(entry.spec) &&
      entry.spec.every((anchor) => typeof anchor === "string")
    )
      descriptor.spec = entry.spec as string[];
    if (typeof entry.passed === "boolean") descriptor.passed = entry.passed;
    return descriptor;
  });
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
  enforceTrue(Array.isArray(raw), new Error(`${what}: expected an array`));
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
    new Error(`${what}: '${field}' is required`),
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
    new Error(`${what}: '${field}' is required`),
  );
  return value;
}
