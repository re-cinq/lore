export type FailureCategory =
  | "anthropic-credit"
  | "anthropic-rate-limit"
  | "github-workflows-permission"
  | "github-permission"
  | "auth"
  | "infra"
  | "unknown";

export interface StepFailure {
  step: string;
  error: string;
}

export interface ClassifiedFailure extends StepFailure {
  category: FailureCategory;
  hint: string;
}

const HINTS: Record<FailureCategory, string> = {
  "anthropic-credit":
    "Top up the Anthropic account behind the agent's ANTHROPIC_API_KEY (Plans & Billing).",
  "anthropic-rate-limit":
    "Anthropic rate limit hit — retry later or raise the account's rate limits.",
  "github-workflows-permission":
    "Grant the Lore GitHub App the 'Workflows: Read & write' permission and accept the install update on the target org.",
  "github-permission":
    "Check the Lore GitHub App's repository permissions and that it is installed on the target repo.",
  auth: "Authentication failed — the token or credential is invalid or expired.",
  infra:
    "The pod died rather than the work failing — a crash, an OOM, an eviction, or a Job deadline. Re-running is the right response; check pod events if it repeats.",
  unknown:
    "Unrecognized failure — see the Event Timeline metadata and agent pod logs.",
};

function categorize(message: string, step?: string): FailureCategory {
  // Two phrasings, one class. The Anthropic API says "Your credit balance is too
  // low to access the Anthropic API"; the agent's own terminal line says
  // "Credit balance is too low"; older copy said "insufficient credit". A second
  // matcher that recognised only some of them is what this replaces.
  if (/credit balance is too low|insufficient credits?/i.test(message)) {
    return "anthropic-credit";
  }

  if (/rate.?limit|\b429\b/i.test(message)) {
    return "anthropic-rate-limit";
  }

  if (/resource not accessible by integration/i.test(message)) {
    return step && /\.github\/workflows\//i.test(step)
      ? "github-workflows-permission"
      : "github-permission";
  }

  if (/\b403\b|forbidden/i.test(message)) {
    return "github-permission";
  }

  if (/\b401\b|bad credentials|unauthorized/i.test(message)) {
    return "auth";
  }

  // The POD died, not the work. These are the Kubernetes-level reasons a Job
  // reports when the agent never got to say anything itself, so they are checked
  // last — a pod that died for a credential reason has already matched above, and
  // its Job would otherwise be reclassified as generic infrastructure.
  //
  // Anchored to the KUBERNETES phrasings. A bare /timed out/ also matches the
  // agent's own "Request timed out" from the Anthropic API, and the infra hint
  // then tells the operator "the pod died rather than the work failing" — which
  // would be false. The retry budget treats `infra` and `unknown` alike, so the
  // cost of the loose match was never behaviour; it was a confidently wrong
  // sentence in the one place someone reads to find out what happened.
  if (
    /backofflimitexceeded|deadlineexceeded|oomkilled|evicted|job .* timed out|timed out waiting/i.test(
      message,
    )
  ) {
    return "infra";
  }

  return "unknown";
}

export function classifyError(
  message: string,
  step?: string,
): { category: FailureCategory; hint: string } {
  const category = categorize(message, step);

  return { category, hint: HINTS[category] };
}

const CATEGORY_LABELS: Record<FailureCategory, string> = {
  "anthropic-credit": "Anthropic credit balance too low",
  "anthropic-rate-limit": "Anthropic rate limit hit",
  "github-workflows-permission": "GitHub App missing Workflows permission",
  "github-permission": "GitHub App permission denied",
  auth: "Authentication failed",
  infra: "Pod or Job infrastructure failure",
  unknown: "Unknown error",
};

/**
 * Categories no retry can clear: the credential, the permission, or the balance
 * has to change first. Spending an assembly line's `iteration_max` budget on one
 * of these buys a second identical failure and a slower, less honest report.
 *
 * `anthropic-rate-limit` is deliberately absent — a later attempt genuinely can
 * succeed. So are `infra` and `unknown`: a crashed pod is the case the retry
 * budget exists for.
 */
const PERMANENT: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  "anthropic-credit",
  "auth",
  "github-permission",
  "github-workflows-permission",
]);

/** The remediation text for a category, for callers that already know the class
 *  and would otherwise re-run the regex over text they have thrown away. */
export function failureHint(category: FailureCategory): string {
  return HINTS[category];
}

/** True for a string that names a category this module knows.
 *
 *  `hasOwn`, not `in`: `in` walks the prototype chain, so "toString" and
 *  "constructor" would both pass and `failureHint` would answer a FUNCTION.
 *  `failure_class` is a plain TEXT column read straight back into a visit, so
 *  this predicate is the only thing between that column and `HINTS[...]`. */
export function isFailureCategory(value: string): value is FailureCategory {
  return Object.hasOwn(HINTS, value);
}

export function isPermanentFailure(category: FailureCategory): boolean {
  return PERMANENT.has(category);
}

export function summarizeFailures(failures: StepFailure[]): {
  summary: string;
  details: ClassifiedFailure[];
} {
  const details: ClassifiedFailure[] = failures.map((f) => {
    const { category, hint } = classifyError(f.error, f.step);

    return { ...f, category, hint };
  });

  const counts = new Map<FailureCategory, number>();

  for (const d of details) {
    counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
  }

  const summary = [...counts.entries()]
    .map(
      ([category, count]) =>
        `${CATEGORY_LABELS[category]} (${count} file${count === 1 ? "" : "s"})`,
    )
    .join("; ");

  return { summary, details };
}

export class TaskFailure extends Error {
  readonly details: ClassifiedFailure[];

  constructor(summary: string, details: ClassifiedFailure[]) {
    super(summary);
    this.name = "TaskFailure";
    this.details = details;
  }
}

/**
 * Best-effort human message for an unknown caught value. Use in `catch (e)`
 * blocks (where `e` is `unknown`) instead of typing the binding `any`.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
