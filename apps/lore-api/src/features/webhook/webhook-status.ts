/**
 * Pure classification of a repo's GitHub webhooks against the canonical Floor
 * ingress URL. The Floor's event bus needs the webhook pointing at
 * `<LORE_WEBHOOK_URL>`, active, subscribed to the trigger events, and with a
 * matching HMAC secret (a 4xx last-delivery is the signature-mismatch tell). This
 * decides which state a repo is in so the UI can show pass/warn/fail + offer a fix.
 * No IO — the route lists hooks + calls this.
 */

export const REQUIRED_EVENTS = [
  "pull_request",
  "pull_request_review",
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
  return events.includes("*") || REQUIRED_EVENTS.every((e) => events.includes(e));
}

export function classifyWebhook(hooks: RepoHook[], canonicalUrl: string): WebhookStatus {
  if (!canonicalUrl) return { state: "unknown", canonicalUrl: "", reason: "webhook_host_not_configured" };

  // Identify the Lore hook: prefer an exact canonical match, else any hook whose
  // URL is the Floor webhook path (so a stale lore-api host still resolves → wrong_url).
  const lore =
    hooks.find((h) => h.config?.url === canonicalUrl) ??
    hooks.find((h) => (h.config?.url ?? "").endsWith("/api/webhook/github"));
  if (!lore) return { state: "missing", canonicalUrl };

  const base = {
    canonicalUrl,
    hookId: lore.id,
    url: lore.config?.url ?? null,
    events: lore.events,
    active: lore.active,
    lastCode: lore.last_response?.code ?? null,
  };

  if (lore.config?.url !== canonicalUrl) return { state: "wrong_url", ...base };
  if (!lore.active) return { state: "inactive", ...base };
  if (!eventsCovered(lore.events)) return { state: "narrow_events", ...base };
  if (base.lastCode !== null && base.lastCode >= 400) return { state: "delivery_failing", ...base };
  return { state: "configured", ...base };
}
