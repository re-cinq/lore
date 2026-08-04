export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  link?: { href: string; text: string };
  /** A fixable check the UI can act on directly (open a PR with the file, or
   *  create/repoint the GitHub webhook). */
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

export function computeEnrollmentChecks(rawInput: EnrollmentInput): Check[] {
  const input = { ...rawInput, now: rawInput.now ?? Date.now() };
  const checks: Check[] = [];

  checks.push({
    id: "onboarded",
    label: "Onboarded",
    status: input.onboarded ? "pass" : "fail",
    detail: input.onboarded
      ? input.onboardedAt
        ? `since ${input.onboardedAt.slice(0, 10)}`
        : "registered in Lore"
      : "repo not registered",
  });

  if (input.onboardingPrUrl) {
    checks.push({
      id: "onboarding-pr",
      label: "Onboarding PR merged",
      status: input.onboardingPrMerged ? "pass" : "warn",
      detail: input.onboardingPrMerged ? undefined : "open",
      link: input.onboardingPrMerged
        ? undefined
        : { href: input.onboardingPrUrl, text: "review & merge" },
    });
  }

  if (!input.lastIngestedAt) {
    checks.push({
      id: "ingested",
      label: "Context ingested",
      status: "fail",
      detail: "never ingested",
    });
  } else {
    const stale =
      input.now - new Date(input.lastIngestedAt).getTime() > STALE_MS;
    const when = daysAgo(input.now, input.lastIngestedAt);

    checks.push({
      id: "ingested",
      label: "Context ingested",
      status: stale ? "warn" : "pass",
      detail: `${stale ? "stale · " : ""}${input.chunkCount} chunks · last ingest ${when}`,
    });
  }

  checks.push({
    id: "conventions",
    label: "Conventions ingested",
    status: input.hasConventions ? "pass" : "fail",
    detail: input.hasConventions
      ? undefined
      : "AGENTS.md / CLAUDE.md not in context",
  });

  checks.push({
    id: "team",
    label: "Team assigned",
    status: input.team ? "pass" : "warn",
    detail: input.team ?? "using org_shared",
  });

  for (const [path, exists] of Object.entries(input.githubFiles)) {
    const status: CheckStatus =
      exists === true ? "pass" : exists === false ? "fail" : "unknown";
    const purpose = GH_FILE_PURPOSE[path];
    const check: Check = {
      id: `gh:${path}`,
      label: `${path} on GitHub`,
      status,
    };

    if (status === "unknown") {
      check.detail = "GitHub App has no repo access";
    } else if (status === "fail") {
      check.detail = purpose ? `missing · ${purpose}` : "missing";
      check.action = { kind: "reonboard", text: "create a PR with this file" };
    } else if (purpose) {
      check.detail = purpose;
    }
    checks.push(check);
  }

  if (input.webhook) {
    const w = input.webhook;
    const WEBHOOK: Record<
      WebhookCheck["state"],
      { status: CheckStatus; detail: string; fixable: boolean }
    > = {
      configured: {
        status: "pass",
        detail: "delivering to the Floor",
        fixable: false,
      },
      missing: {
        status: "fail",
        detail: "no webhook — GitHub events are not delivered",
        fixable: true,
      },
      wrong_url: {
        status: "warn",
        detail: `points at ${w.url ?? "an old host"} — repoint to the Floor`,
        fixable: true,
      },
      inactive: {
        status: "warn",
        detail: "webhook is disabled",
        fixable: true,
      },
      narrow_events: {
        status: "warn",
        detail: "missing event types (PRs / checks / reviews)",
        fixable: true,
      },
      delivery_failing: {
        status: "warn",
        detail: `last delivery ${w.lastCode ?? "failed"} — secret mismatch; re-set up`,
        fixable: true,
      },
      unknown: {
        status: "unknown",
        detail:
          w.reason === "app_no_webhook_permission"
            ? "GitHub App lacks the Webhooks permission"
            : w.reason === "webhook_host_not_configured"
              ? "webhook host not configured"
              : "could not read the webhook",
        fixable: false,
      },
    };
    const m = WEBHOOK[w.state] ?? WEBHOOK.unknown;
    const check: Check = {
      id: "webhook",
      label: "GitHub webhook → Floor",
      status: m.status,
      detail: m.detail,
    };

    if (m.fixable) {
      check.action = { kind: "setup-webhook", text: "set up" };
    }

    // Show the URL to set by hand whenever it's known and not already in place —
    // covers manual setup and the App-lacks-permission case where the button can't help.
    // The signing secret rides alongside (fetched only in this not-configured case).
    if (w.canonicalUrl && w.state !== "configured") {
      check.copy = { value: w.canonicalUrl, label: "set this URL" };

      if (w.secret) {
        check.secret = { value: w.secret, label: "and this secret" };
      }
    }
    checks.push(check);
  }

  const { developerCount, lastActivity } = input.localMcp;

  checks.push({
    id: "local-mcp",
    label: "Used locally via MCP",
    status: developerCount > 0 ? "pass" : "fail",
    detail:
      developerCount > 0
        ? `${developerCount} developer${developerCount === 1 ? "" : "s"}${lastActivity ? ` · last ${daysAgo(input.now, lastActivity)}` : ""}`
        : "no local Claude Code sessions yet",
  });

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
