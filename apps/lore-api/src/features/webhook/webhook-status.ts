/** Classifies repo's GitHub webhooks against canonical Floor ingress URL; no IO (route lists hooks + calls this). */

export const REQUIRED_EVENTS = [
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "check_run",
  "check_suite",
  "issue_comment",
  "issues",
] as const;

export interface RepoHook {
  id: number;
  active: boolean;
  events: string[];
  config: { url?: string };
  last_response?: { code: number | null; status: string | null };
}

export type WebhookState =
  | "configured"
  | "wrong_url"
  | "inactive"
  | "narrow_events"
  | "delivery_failing"
  | "missing"
  | "unknown";

export interface WebhookStatus {
  state: WebhookState;
  canonicalUrl: string;
  hookId?: number;
  url?: string | null;
  events?: string[];
  active?: boolean;
  lastCode?: number | null;
  reason?: string;
}

/** Does this hook's event list cover everything the bus dispatches? */
function eventsCovered(events: string[]): boolean {
  return (
    events.includes("*") || REQUIRED_EVENTS.every((e) => events.includes(e))
  );
}

/** Prefer the hook whose url is an exact canonical match, else any hook at the Floor webhook path. */
function findLoreHook(
  hooks: RepoHook[],
  canonicalUrl: string,
): RepoHook | undefined {
  return (
    hooks.find((h) => h.config?.url === canonicalUrl) ??
    hooks.find((h) => (h.config?.url ?? "").endsWith("/api/webhook/github"))
  );
}

function baseStatus(
  canonicalUrl: string,
  lore: RepoHook,
): Omit<WebhookStatus, "state"> {
  return {
    canonicalUrl,
    hookId: lore.id,
    url: lore.config?.url ?? null,
    events: lore.events,
    active: lore.active,
    lastCode: lore.last_response?.code ?? null,
  };
}

function isFailingDelivery(lastCode: number | null): boolean {
  return lastCode !== null && lastCode >= 400;
}

const HOOK_STATE_RULES: Array<{
  state: WebhookState;
  failing: (lore: RepoHook, base: Omit<WebhookStatus, "state">) => boolean;
}> = [
  {
    state: "wrong_url",
    failing: (_lore, base) => base.url !== base.canonicalUrl,
  },
  { state: "inactive", failing: (lore) => !lore.active },
  {
    state: "narrow_events",
    failing: (lore) => !eventsCovered(lore.events),
  },
  {
    state: "delivery_failing",
    failing: (_lore, base) => isFailingDelivery(base.lastCode ?? null),
  },
];

function deriveHookState(
  lore: RepoHook,
  base: Omit<WebhookStatus, "state">,
): WebhookState {
  return (
    HOOK_STATE_RULES.find((rule) => rule.failing(lore, base))?.state ??
    "configured"
  );
}

export function classifyWebhook(
  hooks: RepoHook[],
  canonicalUrl: string,
): WebhookStatus {
  if (!canonicalUrl) {
    return {
      state: "unknown",
      canonicalUrl: "",
      reason: "webhook_host_not_configured",
    };
  }

  const lore = findLoreHook(hooks, canonicalUrl);

  if (!lore) {
    return { state: "missing", canonicalUrl };
  }

  const base = baseStatus(canonicalUrl, lore);

  return { state: deriveHookState(lore, base), ...base };
}
