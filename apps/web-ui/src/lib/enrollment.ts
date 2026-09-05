export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  link?: { href: string; text: string };
  /** A fixable check the UI can act on directly (open PR or create/repoint webhook). */
  action?:
    | { kind: "reonboard"; text: string }
    | { kind: "setup-webhook"; text: string };
  /** A value to display verbatim with a copy button (e.g. the webhook URL to set by hand). */
  copy?: { value: string; label?: string };
  /** A sensitive value (the webhook signing secret) — rendered masked with reveal + copy. */
  secret?: { value: string; label?: string };
}

/** The repo's GitHub-webhook status, as classified by mcp-server (null = not fetched). */
export interface WebhookCheck {
  state:
    | "configured"
    | "wrong_url"
    | "inactive"
    | "narrow_events"
    | "delivery_failing"
    | "missing"
    | "unknown";
  /** The canonical Floor ingress URL the hook should point at. */
  canonicalUrl?: string;
  url?: string | null;
  lastCode?: number | null;
  reason?: string;
  /** The HMAC signing secret — present only when fetched for manual setup. */
  secret?: string;
}

export interface EnrollmentInput {
  onboarded: boolean;
  onboardedAt: string | null;
  onboardingPrMerged: boolean;
  onboardingPrUrl: string | null;
  lastIngestedAt: string | null;
  chunkCount: number;
  hasConventions: boolean;
  team: string | null;
  /** path -> exists (true/false) or null when unknown (App not configured / no access) */
  githubFiles: Record<string, boolean | null>;
  /** GitHub webhook → Floor status, or null when not fetched. */
  webhook: WebhookCheck | null;
  localMcp: { developerCount: number; lastActivity: string | null };
  /** Reference timestamp for staleness math — injectable for tests, defaults to Date.now(). */
  now?: number;
}

const STALE_MS = 7 * 86_400_000;

const GH_FILE_PURPOSE: Record<string, string> = {
  "AGENTS.md": "context-loading order & conventions for AI agents",
  ".github/workflows/lore-ingest.yml":
    "push-triggered context ingestion — keeps Lore fresh on every push",
};

function daysAgo(now: number, iso: string): string {
  const d = Math.floor((now - new Date(iso).getTime()) / 86_400_000);

  return d <= 0 ? "today" : `${d}d ago`;
}

function ingestedCheck(
  lastIngestedAt: string | null,
  now: number,
  chunkCount: number,
): Check {
  if (!lastIngestedAt) {
    return {
      id: "ingested",
      label: "Context ingested",
      status: "fail",
      detail: "never ingested",
    };
  }
  const stale = now - new Date(lastIngestedAt).getTime() > STALE_MS;
  const when = daysAgo(now, lastIngestedAt);

  return {
    id: "ingested",
    label: "Context ingested",
    status: stale ? "warn" : "pass",
    detail: `${stale ? "stale · " : ""}${chunkCount} chunks · last ingest ${when}`,
  };
}

function githubFileStatus(exists: boolean | null): CheckStatus {
  if (exists === true) {
    return "pass";
  }

  if (exists === false) {
    return "fail";
  }

  return "unknown";
}

function githubFileCheck(path: string, exists: boolean | null): Check {
  const status = githubFileStatus(exists);
  const purpose = GH_FILE_PURPOSE[path];
  const check: Check = {
    id: `gh:${path}`,
    label: `${path} on GitHub`,
    status,
  };

  if (status === "unknown") {
    check.detail = "GitHub App has no repo access";

    return check;
  }

  if (status === "fail") {
    check.detail = purpose ? `missing · ${purpose}` : "missing";
    check.action = { kind: "reonboard", text: "create a PR with this file" };

    return check;
  }

  if (purpose) {
    check.detail = purpose;
  }

  return check;
}

function onboardedDetail(
  onboarded: boolean,
  onboardedAt: string | null,
): string {
  if (!onboarded) {
    return "repo not registered";
  }

  if (onboardedAt) {
    return `since ${onboardedAt.slice(0, 10)}`;
  }

  return "registered in Lore";
}

function unknownWebhookDetail(reason: string | undefined): string {
  if (reason === "app_no_webhook_permission") {
    return "GitHub App lacks the Webhooks permission";
  }

  if (reason === "webhook_host_not_configured") {
    return "webhook host not configured";
  }

  return "could not read the webhook";
}

const WEBHOOK_STATE: Record<
  WebhookCheck["state"],
  { status: CheckStatus; fixable: boolean }
> = {
  configured: { status: "pass", fixable: false },
  missing: { status: "fail", fixable: true },
  wrong_url: { status: "warn", fixable: true },
  inactive: { status: "warn", fixable: true },
  narrow_events: { status: "warn", fixable: true },
  delivery_failing: { status: "warn", fixable: true },
  unknown: { status: "unknown", fixable: false },
};

const WEBHOOK_DETAIL: Record<
  WebhookCheck["state"],
  (w: WebhookCheck) => string
> = {
  configured: () => "delivering to the Floor",
  missing: () => "no webhook — GitHub events are not delivered",
  wrong_url: (w) =>
    `points at ${w.url ?? "an old host"} — repoint to the Floor`,
  inactive: () => "webhook is disabled",
  narrow_events: () => "missing event types (PRs / checks / reviews)",
  delivery_failing: (w) =>
    `last delivery ${w.lastCode ?? "failed"} — secret mismatch; re-set up`,
  unknown: (w) => unknownWebhookDetail(w.reason),
};

/** Manual setup fields (URL + signing secret) only make sense while the hook isn't already delivering. */
function applyManualSetupFields(check: Check, w: WebhookCheck): void {
  if (!w.canonicalUrl || w.state === "configured") {
    return;
  }
  check.copy = { value: w.canonicalUrl, label: "set this URL" };

  if (w.secret) {
    check.secret = { value: w.secret, label: "and this secret" };
  }
}

function webhookCheckRow(w: WebhookCheck): Check {
  const stateInfo = WEBHOOK_STATE[w.state];
  const detail = WEBHOOK_DETAIL[w.state](w);
  const check: Check = {
    id: "webhook",
    label: "GitHub webhook → Floor",
    status: stateInfo.status,
    detail,
  };

  if (stateInfo.fixable) {
    check.action = { kind: "setup-webhook", text: "set up" };
  }
  applyManualSetupFields(check, w);

  return check;
}

function onboardedCheck(onboarded: boolean, onboardedAt: string | null): Check {
  return {
    id: "onboarded",
    label: "Onboarded",
    status: onboarded ? "pass" : "fail",
    detail: onboardedDetail(onboarded, onboardedAt),
  };
}

function onboardingPrCheck(prUrl: string, prMerged: boolean): Check {
  return {
    id: "onboarding-pr",
    label: "Onboarding PR merged",
    status: prMerged ? "pass" : "warn",
    detail: prMerged ? undefined : "open",
    link: prMerged ? undefined : { href: prUrl, text: "review & merge" },
  };
}

function conventionsCheck(hasConventions: boolean): Check {
  return {
    id: "conventions",
    label: "Conventions ingested",
    status: hasConventions ? "pass" : "fail",
    detail: hasConventions ? undefined : "AGENTS.md / CLAUDE.md not in context",
  };
}

function teamCheck(team: string | null): Check {
  return {
    id: "team",
    label: "Team assigned",
    status: team ? "pass" : "warn",
    detail: team ?? "using org_shared",
  };
}

function localMcpDetail(
  now: number,
  developerCount: number,
  lastActivity: string | null,
): string {
  if (developerCount === 0) {
    return "no local Claude Code sessions yet";
  }
  const plural = developerCount === 1 ? "" : "s";
  const lastSeen = lastActivity ? ` · last ${daysAgo(now, lastActivity)}` : "";

  return `${developerCount} developer${plural}${lastSeen}`;
}

function localMcpCheck(
  now: number,
  developerCount: number,
  lastActivity: string | null,
): Check {
  return {
    id: "local-mcp",
    label: "Used locally via MCP",
    status: developerCount > 0 ? "pass" : "fail",
    detail: localMcpDetail(now, developerCount, lastActivity),
  };
}

export function computeEnrollmentChecks(rawInput: EnrollmentInput): Check[] {
  const input = { ...rawInput, now: rawInput.now ?? Date.now() };
  const checks: Check[] = [onboardedCheck(input.onboarded, input.onboardedAt)];

  if (input.onboardingPrUrl) {
    checks.push(
      onboardingPrCheck(input.onboardingPrUrl, input.onboardingPrMerged),
    );
  }

  checks.push(ingestedCheck(input.lastIngestedAt, input.now, input.chunkCount));
  checks.push(conventionsCheck(input.hasConventions));
  checks.push(teamCheck(input.team));

  for (const [path, exists] of Object.entries(input.githubFiles)) {
    checks.push(githubFileCheck(path, exists));
  }

  if (input.webhook) {
    checks.push(webhookCheckRow(input.webhook));
  }

  checks.push(
    localMcpCheck(
      input.now,
      input.localMcp.developerCount,
      input.localMcp.lastActivity,
    ),
  );

  return checks;
}

export function passSummary(checks: Check[]): {
  passed: number;
  total: number;
} {
  return {
    passed: checks.filter((c) => c.status === "pass").length,
    total: checks.length,
  };
}
