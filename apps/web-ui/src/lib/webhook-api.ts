// Thin server-side client for the mcp-server webhook status/ensure API — the
// GitHub App + the HMAC secret live in mcp-server, so the web-ui only reads the
// status and triggers a fix across the same LORE_API_URL + LORE_INGEST_TOKEN
// boundary trace-api uses. IO glue — excluded from coverage like lib/db.ts.

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

function creds(): { api: string; token: string } | null {
  const api = process.env.LORE_API_URL;
  const token = process.env.LORE_INGEST_TOKEN;
  return api && token ? { api, token } : null;
}

export async function getWebhookStatus(
  repo: string,
): Promise<WebhookStatus | null> {
  const c = creds();
  if (!c) return null;
  const res = await fetch(`${c.api}/api/repos/${repo}/webhook`, {
    headers: { Authorization: `Bearer ${c.token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as WebhookStatus;
}

/**
 * Reveal the HMAC signing secret so it can be set by hand alongside the URL
 * (admin-scoped on mcp-server). Fetched only when the webhook needs manual setup.
 */
export async function getWebhookSecret(repo: string): Promise<string | null> {
  const c = creds();
  if (!c) return null;
  const res = await fetch(`${c.api}/api/repos/${repo}/webhook/secret`, {
    headers: { Authorization: `Bearer ${c.token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { secret?: string };
  return body.secret ?? null;
}

export async function ensureWebhook(
  repo: string,
): Promise<WebhookStatus | { error: string }> {
  const c = creds();
  if (!c) return { error: "web-ui is not configured to reach the Lore API" };
  const res = await fetch(`${c.api}/api/repos/${repo}/webhook/ensure`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: body?.error || `webhook setup failed (${res.status})` };
  }
  return (await res.json()) as WebhookStatus;
}
