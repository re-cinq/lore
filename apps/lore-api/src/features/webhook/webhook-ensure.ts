/**
 * `ensureFloorWebhook` — the one place that ensures a repo's GitHub webhook points
 * at the Floor ingress *with the HMAC secret*. Reads `LORE_WEBHOOK_URL` +
 * `LORE_WEBHOOK_SECRET` and the canonical event set, then delegates to the
 * idempotent `ensureRepoWebhook`. Best-effort by design: it never throws, it
 * returns a discriminated outcome so callers (onboarding, the ensure route) can
 * react without each re-deriving the env/policy — keeping them in lockstep so a
 * webhook can't be created unsigned again.
 */

import { ensureRepoWebhook } from "./webhook-manage.js";
import { REQUIRED_EVENTS } from "./webhook-status.js";

export type WebhookSkipReason =
  | "webhook_host_not_configured"
  | "secret_not_configured"
  | "app_no_webhook_permission"
  | "ensure_failed";

export type EnsureFloorWebhookResult =
  | { ok: true; hookId: number; created: boolean }
  | { ok: false; reason: WebhookSkipReason; detail?: string };

export async function ensureFloorWebhook(
  repo: string,
): Promise<EnsureFloorWebhookResult> {
  const url = process.env.LORE_WEBHOOK_URL || "";
  const secret = process.env.LORE_WEBHOOK_SECRET || "";

  if (!url) {
    return { ok: false, reason: "webhook_host_not_configured" };
  }

  if (!secret) {
    return { ok: false, reason: "secret_not_configured" };
  }

  try {
    const { hookId, created } = await ensureRepoWebhook(repo, url, secret, [
      ...REQUIRED_EVENTS,
    ]);

    return { ok: true, hookId, created };
  } catch (err: any) {
    if (err?.status === 403) {
      return { ok: false, reason: "app_no_webhook_permission" };
    }

    return {
      ok: false,
      reason: "ensure_failed",
      detail: err?.message || String(err),
    };
  }
}
