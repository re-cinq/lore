import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { z } from "zod";
import { errorMessage } from "@re-cinq/lore-shared";
// Webhook routes: GET/POST/secret for read/write/admin with graceful degradation.

import type { ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { listRepoWebhooks } from "../../../features/webhook/webhook-manage.js";
import {
  ensureFloorWebhook,
  type EnsureFloorWebhookResult,
  type WebhookSkipReason,
} from "../../../features/webhook/webhook-ensure.js";
import { classifyWebhook } from "../../../features/webhook/webhook-status.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

function canonicalUrl(): string {
  return process.env.LORE_WEBHOOK_URL || "";
}

const repoOf = (request: { params: Record<string, string> }) =>
  `${request.params.owner}/${request.params.repo}`;

// Webhook status with graceful degradation: state "unknown" + REASON avoids no-permission confusion.
const WebhookStatusSchema = z.object({
  state: z.string(),
  canonicalUrl: z.string(),
  hookId: z.number().optional(),
  url: z.string().nullable().optional(),
  events: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  lastCode: z.number().nullable().optional(),
  reason: z.string().optional(),
});

const WebhookSecretSchema = z.object({
  secret: z.string(),
  canonicalUrl: z.string(),
});

export function webhookStatusRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/webhook",
    options: zodResponse(bearerScope("read"), WebhookStatusSchema, {
      name: "RepoWebhookStatus",
      description: "Whether the repo's webhook points at this platform",
    }),
    handler: async (request, h) => {
      const url = canonicalUrl();

      if (!url) {
        return h.response({
          state: "unknown",
          canonicalUrl: "",
          reason: "webhook_host_not_configured",
        });
      }

      try {
        return h.response(
          classifyWebhook(await listRepoWebhooks(repoOf(request)), url),
        );
      } catch (err) {
        // 403 = App lacks Webhooks permission; surface as unknown for graceful UI fallback.
        const reason =
          (err as { status?: number })?.status === 403
            ? "app_no_webhook_permission"
            : "read_failed";

        return h.response({ state: "unknown", canonicalUrl: url, reason });
      }
    },
  };
}

export function webhookSecretRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/webhook/secret",
    // Admin-only: secret is shared across all hooks.
    options: zodResponse(bearerScope("admin"), WebhookSecretSchema, {
      name: "RepoWebhookSecret",
      description: "The HMAC secret a repo's webhook must sign with",
    }),
    handler: async (_request, h) => {
      const secret = process.env.LORE_WEBHOOK_SECRET || "";

      enforceTrue(secret, apiError(503), "LORE_WEBHOOK_SECRET not configured");

      return h.response({ secret, canonicalUrl: canonicalUrl() });
    },
  };
}

const ENSURE_SKIP_STATUS: Partial<
  Record<WebhookSkipReason, { status: number; error: string }>
> = {
  webhook_host_not_configured: {
    status: 503,
    error: "LORE_WEBHOOK_URL not configured",
  },
  secret_not_configured: {
    status: 503,
    error: "LORE_WEBHOOK_SECRET not configured",
  },
  app_no_webhook_permission: {
    status: 403,
    error: "GitHub App lacks the Webhooks (read & write) permission",
  },
};

// A named skip reason maps to its status; any other (e.g. `ensure_failed`) falls back to 500 + detail.
function ensureSkipResponse(
  h: ResponseToolkit,
  result: Extract<EnsureFloorWebhookResult, { ok: false }>,
) {
  const mapped = ENSURE_SKIP_STATUS[result.reason];

  if (mapped) {
    return h.response({ error: mapped.error }).code(mapped.status);
  }

  return h
    .response({ error: result.detail || "webhook ensure failed" })
    .code(500);
}

async function freshWebhookStatus(h: ResponseToolkit, repo: string) {
  try {
    return h.response(
      classifyWebhook(await listRepoWebhooks(repo), canonicalUrl()),
    );
  } catch (err) {
    return h.response({ error: errorMessage(err) || String(err) }).code(500);
  }
}

export function webhookEnsureRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/webhook/ensure",
    options: zodResponse(bearerScope("write"), WebhookStatusSchema, {
      name: "RepoWebhookEnsured",
      description: "The webhook's state after ensuring it",
    }),
    handler: async (request, h) => {
      const repo = repoOf(request);
      // Shared with onboarding: ensureFloorWebhook reads LORE_WEBHOOK_URL/SECRET.
      const result = await ensureFloorWebhook(repo);

      if (!result.ok) {
        return ensureSkipResponse(h, result);
      }

      return freshWebhookStatus(h, repo);
    },
  };
}
