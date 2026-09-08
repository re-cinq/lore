// HTTP client for lore-api's webhook status/ensure API (IO glue, excluded from coverage).
import { loreApiGet } from "@/lib/lore-api-get";
import { resolveLoreApiConfig } from "@/lib/lore-api-config";

export interface WebhookStatus {
  state:
    | "configured"
    | "wrong_url"
    | "inactive"
    | "narrow_events"
    | "delivery_failing"
    | "missing"
    | "unknown";
  canonicalUrl?: string;
  url?: string | null;
  events?: string[];
  active?: boolean;
  lastCode?: number | null;
  reason?: string;
  /** The HMAC signing secret, only fetched (via getWebhookSecret) for manual setup. */
  secret?: string;
}

export function getWebhookStatus(repo: string): Promise<WebhookStatus | null> {
  return loreApiGet<WebhookStatus>(`/api/repos/${repo}/webhook`);
}

/** Reveals HMAC signing secret for manual webhook setup (admin-scoped). */
export async function getWebhookSecret(repo: string): Promise<string | null> {
  const body = await loreApiGet<{ secret?: string }>(
    `/api/repos/${repo}/webhook/secret`,
  );

  return body?.secret ?? null;
}

export async function ensureWebhook(
  repo: string,
): Promise<WebhookStatus | { error: string }> {
  const config = resolveLoreApiConfig();

  if (!config) {
    return { error: "web-ui is not configured to reach the Lore API" };
  }
  const res = await fetch(`${config.apiUrl}/api/repos/${repo}/webhook/ensure`, {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };

    return { error: body.error || `webhook setup failed (${res.status})` };
  }

  return (await res.json()) as WebhookStatus;
}
