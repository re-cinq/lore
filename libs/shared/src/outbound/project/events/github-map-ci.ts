/** The params of the two GitHub events that say a PR's CI or base moved: a finished check suite and a branch push (specs/protected-branch-merge). Null when the delivery maps to no event. */

interface CheckSuitePayload {
  action?: string;
  check_suite?: {
    head_sha?: string;
    pull_requests?: Array<{ number?: unknown } | null>;
  };
}

export function checkSuiteParams(
  payload: CheckSuitePayload,
  repo: string,
): Record<string, unknown> | null {
  const suite = payload.check_suite;

  if (payload.action !== "completed" || !suite?.head_sha) {
    return null;
  }
  const numbers = (suite.pull_requests ?? []).map((pr) => pr?.number);

  return {
    repo,
    head_sha: suite.head_sha,
    pr_numbers: numbers.filter((n): n is number => typeof n === "number"),
  };
}

const BRANCH_REF_PREFIX = "refs/heads/";

/** A tag push names no branch a PR could merge into, so it maps to nothing. */
export function branchPushParams(
  payload: { ref?: string },
  repo: string,
): Record<string, unknown> | null {
  const ref = payload.ref ?? "";

  return ref.startsWith(BRANCH_REF_PREFIX)
    ? { repo, branch: ref.slice(BRANCH_REF_PREFIX.length) }
    : null;
}
