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
  /** GitHub webhook → Lore status, or null when not fetched. */
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

function neverIngestedCheck(): Check {
  return {
    id: "ingested",
    label: "Context ingested",
    status: "fail",
    detail: "never ingested",
  };
}

function ingestedCheck(
  lastIngestedAt: string | null,
  now: number,
  chunkCount: number,
): Check {
  if (!lastIngestedAt) {
    return neverIngestedCheck();
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

function githubFileStatus(file: { exists: boolean | null }): CheckStatus {
  if (file.exists === true) {
    return "pass";
  }

  if (file.exists === false) {
    return "fail";
  }

  return "unknown";
}

/** Unknown and missing carry their own wording; a file that is there carries only its purpose. */
function applyGithubFileDetail(
  check: Check,
  purpose: string | undefined,
): void {
  if (check.status === "unknown") {
    check.detail = "GitHub App has no repo access";

    return;
  }

  if (check.status === "fail") {
    check.detail = purpose ? `missing · ${purpose}` : "missing";
    check.action = { kind: "reonboard", text: "create a PR with this file" };

    return;
  }

  if (purpose) {
    check.detail = purpose;
  }
}

function githubFileCheck(
  path: string,
  file: { exists: boolean | null },
): Check {
  const check: Check = {
    id: `gh:${path}`,
    label: `${path} on GitHub`,
    status: githubFileStatus(file),
  };

  applyGithubFileDetail(check, GH_FILE_PURPOSE[path]);

  return check;
}

function onboardedDetail(
  repo: Pick<EnrollmentInput, "onboarded" | "onboardedAt">,
): string {
  const { onboarded, onboardedAt } = repo;

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
    label: "GitHub webhook → Lore",
    status: stateInfo.status,
    detail,
  };

  if (stateInfo.fixable) {
    check.action = { kind: "setup-webhook", text: "set up" };
  }
  applyManualSetupFields(check, w);

  return check;
}

function onboardedCheck(
  repo: Pick<EnrollmentInput, "onboarded" | "onboardedAt">,
): Check {
  return {
    id: "onboarded",
    label: "Onboarded",
    status: repo.onboarded ? "pass" : "fail",
    detail: onboardedDetail(repo),
  };
}

function onboardingPrCheck(pr: { url: string; merged: boolean }): Check {
  return {
    id: "onboarding-pr",
    label: "Onboarding PR merged",
    status: pr.merged ? "pass" : "warn",
    detail: pr.merged ? undefined : "open",
    link: pr.merged ? undefined : { href: pr.url, text: "review & merge" },
  };
}

function conventionsCheck(
  repo: Pick<EnrollmentInput, "hasConventions">,
): Check {
  return {
    id: "conventions",
    label: "Conventions ingested",
    status: repo.hasConventions ? "pass" : "fail",
    detail: repo.hasConventions
      ? undefined
      : "AGENTS.md / CLAUDE.md not in context",
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

type ResolvedInput = EnrollmentInput & { now: number };

/** One row per probed GitHub file, then the webhook row when it was fetched. */
function repoSurfaceChecks(input: ResolvedInput): Check[] {
  const { githubFiles, webhook } = input;
  const files = Object.entries(githubFiles).map(([path, exists]) =>
    githubFileCheck(path, { exists }),
  );

  return webhook ? [...files, webhookCheckRow(webhook)] : files;
}

export function computeEnrollmentChecks(rawInput: EnrollmentInput): Check[] {
  const input = { ...rawInput, now: rawInput.now ?? Date.now() };
  const { onboardingPrUrl, onboardingPrMerged, localMcp, now } = input;

  return [
    onboardedCheck(input),
    ...(onboardingPrUrl
      ? [
          onboardingPrCheck({
            url: onboardingPrUrl,
            merged: onboardingPrMerged,
          }),
        ]
      : []),
    ingestedCheck(input.lastIngestedAt, now, input.chunkCount),
    conventionsCheck(input),
    teamCheck(input.team),
    ...repoSurfaceChecks(input),
    localMcpCheck(now, localMcp.developerCount, localMcp.lastActivity),
  ];
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
