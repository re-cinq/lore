/**
 * `GET /api/repos/:o/:r/webhook` — classify the repo's GitHub webhook against the
 * canonical Floor ingress URL (read scope). `POST .../webhook/ensure` — create or
 * repoint the hook with the right URL/events/secret, then return the new status
 * (write scope). `GET .../webhook/secret` — reveal the shared HMAC signing secret
 * (admin scope). All degrade to `unknown` when the App lacks the Webhooks
 * permission or `LORE_WEBHOOK_URL` is unset, so the UI never breaks.
 */

import type { ServerRoute } from "@hapi/hapi";
import { listRepoWebhooks } from "../../../features/webhook/webhook-manage.js";
import { ensureFloorWebhook } from "../../../features/webhook/webhook-ensure.js";
import { classifyWebhook } from "../../../features/webhook/webhook-status.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

function canonicalUrl(): string {
  return process.env.LORE_WEBHOOK_URL || "";
}

const repoOf = (request: { params: Record<string, string> }) => `${request.params.owner}/${request.params.repo}`;

export function webhookStatusRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/webhook",
    options: bearerScope("read"),
    handler: async (request, h) => {
      const url = canonicalUrl();
      if (!url) return h.response({ state: "unknown", canonicalUrl: "", reason: "webhook_host_not_configured" });
      try {
        return h.response(classifyWebhook(await listRepoWebhooks(repoOf(request)), url));
      } catch (err: any) {
        // 403 = the App lacks the Webhooks permission. Surface as unknown so the UI
        // degrades gracefully (like the githubFiles 'no access' state).
        const reason = err?.status === 403 ? "app_no_webhook_permission" : "read_failed";
        return h.response({ state: "unknown", canonicalUrl: url, reason });
      }
    },
  };
}

export function webhookSecretRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/webhook/secret",
    // Admin: the secret is shared across all hooks, so it must not ride the
    // read-scope status response.
    options: bearerScope("admin"),
    handler: async (_request, h) => {
      const secret = process.env.LORE_WEBHOOK_SECRET || "";
      if (!secret) return h.response({ error: "LORE_WEBHOOK_SECRET not configured" }).code(503);
      return h.response({ secret, canonicalUrl: canonicalUrl() });
    },
  };
}

export function webhookEnsureRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/webhook/ensure",
    options: bearerScope("write"),
    handler: async (request, h) => {
      const repo = repoOf(request);
      // Shared with onboarding: ensureFloorWebhook reads LORE_WEBHOOK_URL/SECRET +
      // the canonical events and repoints/creates the hook with the HMAC secret.
      const result = await ensureFloorWebhook(repo);
      if (!result.ok) {
        switch (result.reason) {
          case "webhook_host_not_configured":
            return h.response({ error: "LORE_WEBHOOK_URL not configured" }).code(503);
          case "secret_not_configured":
            return h.response({ error: "LORE_WEBHOOK_SECRET not configured" }).code(503);
          case "app_no_webhook_permission":
            return h.response({ error: "GitHub App lacks the Webhooks (read & write) permission" }).code(403);
          default:
            return h.response({ error: result.detail || "webhook ensure failed" }).code(500);
        }
      }
      try {
        return h.response(classifyWebhook(await listRepoWebhooks(repo), canonicalUrl()));
      } catch (err: any) {
        return h.response({ error: err?.message || String(err) }).code(500);
      }
    },
  };
}
