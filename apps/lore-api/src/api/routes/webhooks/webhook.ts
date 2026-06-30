/**
 * `GET /api/repos/:o/:r/webhook` — classify the repo's GitHub webhook against the
 * canonical Floor ingress URL (read scope). `POST .../webhook/ensure` — create or
 * repoint the hook with the right URL/events/secret, then return the new status
 * (write scope). Both degrade to `unknown` when the App lacks the Webhooks
 * permission or `LORE_WEBHOOK_URL` is unset, so the UI never breaks.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { listRepoWebhooks } from "../../../features/webhook/webhook-manage.js";
import { ensureFloorWebhook } from "../../../features/webhook/webhook-ensure.js";
import { classifyWebhook } from "../../../features/webhook/webhook-status.js";
import { json, repoFromReposUrl } from "../http.js";

function canonicalUrl(): string {
  return process.env.LORE_WEBHOOK_URL || "";
}

export async function handleWebhookStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const repo = repoFromReposUrl(req.url);
  if (!repo) {
    json(res, 400, { error: "could not resolve repo from url" });
    return;
  }
  const url = canonicalUrl();
  if (!url) {
    json(res, 200, { state: "unknown", canonicalUrl: "", reason: "webhook_host_not_configured" });
    return;
  }
  try {
    json(res, 200, classifyWebhook(await listRepoWebhooks(repo), url));
  } catch (err: any) {
    // 403 = the App lacks the Webhooks permission. Surface as unknown so the UI
    // degrades gracefully (like the githubFiles 'no access' state).
    const reason = err?.status === 403 ? "app_no_webhook_permission" : "read_failed";
    json(res, 200, { state: "unknown", canonicalUrl: url, reason });
  }
}

/**
 * `GET .../webhook/secret` — reveal the HMAC signing secret so an operator can
 * set a repo's webhook BY HAND (the App can't always manage it). Admin scope —
 * the secret is shared across all hooks, so it must not ride the read-scope
 * status response. 503 when no secret is configured.
 */
export async function handleWebhookSecret(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const repo = repoFromReposUrl(req.url);
  if (!repo) {
    json(res, 400, { error: "could not resolve repo from url" });
    return;
  }
  const secret = process.env.LORE_WEBHOOK_SECRET || "";
  if (!secret) {
    json(res, 503, { error: "LORE_WEBHOOK_SECRET not configured" });
    return;
  }
  json(res, 200, { secret, canonicalUrl: canonicalUrl() });
}

export async function handleWebhookEnsure(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const repo = repoFromReposUrl(req.url);
  if (!repo) {
    json(res, 400, { error: "could not resolve repo from url" });
    return;
  }
  // Shared with onboarding: ensureFloorWebhook reads LORE_WEBHOOK_URL/SECRET +
  // the canonical events and repoints/creates the hook with the HMAC secret.
  const result = await ensureFloorWebhook(repo);
  if (!result.ok) {
    switch (result.reason) {
      case "webhook_host_not_configured":
        return json(res, 503, { error: "LORE_WEBHOOK_URL not configured" });
      case "secret_not_configured":
        return json(res, 503, { error: "LORE_WEBHOOK_SECRET not configured" });
      case "app_no_webhook_permission":
        return json(res, 403, { error: "GitHub App lacks the Webhooks (read & write) permission" });
      default:
        return json(res, 500, { error: result.detail || "webhook ensure failed" });
    }
  }
  try {
    json(res, 200, classifyWebhook(await listRepoWebhooks(repo), canonicalUrl()));
  } catch (err: any) {
    json(res, 500, { error: err?.message || String(err) });
  }
}
