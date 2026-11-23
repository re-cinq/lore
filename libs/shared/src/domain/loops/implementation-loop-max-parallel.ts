import { parsedSettings } from "./raw-settings.js";

export const DEFAULT_MAX_PARALLEL = 1;
const MAX_PARALLEL_CEILING = 5;

export function isMaxParallel(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_PARALLEL_CEILING
  );
}

/** How many ticket runs a repository may have open at once: `implementation_loop.max_parallel`, one when absent or not a whole number from 1 to 5. */
export function implementationLoopMaxParallel(rawSettings: unknown): number {
  const block = (
    parsedSettings(rawSettings) as {
      implementation_loop?: { max_parallel?: unknown };
    } | null
  )?.implementation_loop;

  return isMaxParallel(block?.max_parallel)
    ? block.max_parallel
    : DEFAULT_MAX_PARALLEL;
}
