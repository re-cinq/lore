import { errorMessage } from "@re-cinq/lore-shared";

/** Ensures repo's GitHub webhook points to Floor ingress with HMAC secret (best-effort, never throws). */

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

function classifyEnsureFailure(err: unknown): EnsureFloorWebhookResult {
  if ((err as { status?: number })?.status === 403) {
    return { ok: false, reason: "app_no_webhook_permission" };
  }

  return {
    ok: false,
    reason: "ensure_failed",
    detail: errorMessage(err) || String(err),
  };
}

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
  } catch (err) {
    return classifyEnsureFailure(err);
  }
}
