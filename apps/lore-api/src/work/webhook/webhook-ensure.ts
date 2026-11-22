import type { Octokit } from "octokit";
import { errorMessage } from "@re-cinq/lore-shared";

/** Ensures the repo's GitHub webhook points at the public `/api/events` URL (ADR-044) with the HMAC secret (best-effort, never throws). */

import { ensureRepoWebhook, ensureRepoWebhookWith } from "./webhook-manage.js";
import { REQUIRED_EVENTS } from "./webhook-status.js";

export type WebhookSkipReason =
  | "webhook_host_not_configured"
  | "secret_not_configured"
  | "app_no_webhook_permission"
  | "ensure_failed";

export type EnsureLoreWebhookResult =
  | { ok: true; hookId: number; created: boolean }
  | { ok: false; reason: WebhookSkipReason; detail?: string };

export async function ensureLoreWebhook(
  repo: string,
  octokit?: Octokit,
): Promise<EnsureLoreWebhookResult> {
  const hook = {
    url: process.env.LORE_WEBHOOK_URL || "",
    secret: process.env.LORE_WEBHOOK_SECRET || "",
  };
  const unset = unsetReason(hook.url, hook.secret);

  if (unset) {
    return { ok: false, reason: unset };
  }

  try {
    const { hookId, created } = await ensureHook(repo, hook, octokit);

    return { ok: true, hookId, created };
  } catch (err) {
    return classifyEnsureFailure(err);
  }
}

function unsetReason(url: string, secret: string): WebhookSkipReason | null {
  if (!url) {
    return "webhook_host_not_configured";
  }

  return secret ? null : "secret_not_configured";
}

function ensureHook(
  repo: string,
  hook: { url: string; secret: string },
  octokit?: Octokit,
) {
  const events = [...REQUIRED_EVENTS];

  return octokit
    ? ensureRepoWebhookWith(octokit, repo, { ...hook, events })
    : ensureRepoWebhook(repo, hook.url, hook.secret, events);
}

function classifyEnsureFailure(err: unknown): EnsureLoreWebhookResult {
  if ((err as { status?: number }).status === 403) {
    return { ok: false, reason: "app_no_webhook_permission" };
  }

  return {
    ok: false,
    reason: "ensure_failed",
    detail: errorMessage(err) || String(err),
  };
}
