// Runtime array (not just a type): NodeResultSchema's zod enum drops any class not listed here.
export const FAILURE_CATEGORIES = [
  "anthropic-credit",
  "anthropic-rate-limit",
  "github-workflows-permission",
  "github-permission",
  "auth",
  "agent-settings-missing",
  "infra",
  "unclaimed",
  "unknown",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

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
  "agent-settings-missing":
    "The AgentDefinition's skills_source is unreachable, so the init never wrote /agent/.claude/settings.json and Claude Code hard-errored. Verify skills_source on the recipe points at a reachable skills registry (see #1125) — every Claude-agent node on the affected cluster fails identically until it does.",
  infra:
    "The pod died rather than the work failing — a crash, an OOM, an eviction, or a Job deadline. Re-running is the right response; check pod events if it repeats.",
  unclaimed:
    "No cluster-agent claimed the run, so nothing ever ran. The clusters offering these tags are named above: check the registry (Clusters page) for one that is paused, offline, or absent. Re-running cannot help until one is active and un-paused.",
  unknown:
    "Unrecognized failure — see the Event Timeline metadata and agent pod logs.",
};

/** GitHub's "resource not accessible by integration" is either a workflow-file permission gap or a general one, depending on which step failed. */
function resourceNotAccessibleCategory(
  message: string,
  step?: string,
): FailureCategory | undefined {
  if (!/resource not accessible by integration/i.test(message)) {
    return undefined;
  }

  return step && /\.github\/workflows\//i.test(step)
    ? "github-workflows-permission"
    : "github-permission";
}

// Ordered most-specific-first — e.g. settings-file runs ahead of `infra`, whose CR also carries BackoffLimitExceeded.
const CATEGORY_MATCHERS: ((
  message: string,
  step?: string,
) => FailureCategory | undefined)[] = [
  // Matches all known phrasings of the credit error (API, agent terminal line, older copy).
  (m) =>
    /credit balance is too low|insufficient credits?/i.test(m)
      ? "anthropic-credit"
      : undefined,
  (m) => (/rate.?limit|\b429\b/i.test(m) ? "anthropic-rate-limit" : undefined),
  // GitHub's 422 on a workflow-file write; the message names the file, so no step context is needed.
  (m) =>
    /refusing to allow .* workflow/i.test(m)
      ? "github-workflows-permission"
      : undefined,
  resourceNotAccessibleCategory,
  (m) => (/\b403\b|forbidden/i.test(m) ? "github-permission" : undefined),
  (m) => (/\b401\b|bad credentials|unauthorized/i.test(m) ? "auth" : undefined),
  (m) =>
    /settings file not found/i.test(m) ? "agent-settings-missing" : undefined,
  // Anchored to Kubernetes phrasings so a bare "timed out" from the Anthropic API isn't misreported as a pod death.
  (m) =>
    /backofflimitexceeded|deadlineexceeded|oomkilled|evicted|job .* timed out|timed out waiting/i.test(
      m,
    )
      ? "infra"
      : undefined,
];

function categorize(message: string, step?: string): FailureCategory {
  for (const matcher of CATEGORY_MATCHERS) {
    const category = matcher(message, step);

    if (category) {
      return category;
    }
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
  "agent-settings-missing":
    "Agent settings file missing (skills_source unreachable)",
  infra: "Pod or Job infrastructure failure",
  unclaimed: "No cluster-agent claimed the run",
  unknown: "Unknown error",
};

// Categories no retry can clear (credential/permission/balance); `unclaimed` included since re-running the previous node can't summon a cluster (#1648). `anthropic-rate-limit`/`infra`/`unknown` deliberately excluded — retry can succeed there.
const PERMANENT: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  "anthropic-credit",
  "unclaimed",
  "auth",
  "github-permission",
  "github-workflows-permission",
  "agent-settings-missing",
]);

export function failureHint(category: FailureCategory): string {
  return HINTS[category];
}

// `hasOwn`, not `in`: `in` walks the prototype chain, so "toString"/"constructor" would falsely pass.
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

// Use in `catch (e)` blocks (where `e` is `unknown`) instead of typing the binding `any`.
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
