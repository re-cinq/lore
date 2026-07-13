export type FailureCategory =
  | "anthropic-credit"
  | "anthropic-rate-limit"
  | "github-workflows-permission"
  | "github-permission"
  | "auth"
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
  unknown:
    "Unrecognized failure — see the Event Timeline metadata and agent pod logs.",
};

function categorize(message: string, step?: string): FailureCategory {
  if (/credit balance is too low/i.test(message)) {
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
  unknown: "Unknown error",
};

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
