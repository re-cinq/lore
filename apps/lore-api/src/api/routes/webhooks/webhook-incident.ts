import type { Pool } from "pg";
import type { Request, ServerRoute } from "@hapi/hapi";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { formatZodError } from "../../../server/plugins/zod-validate.js";
import { rawBody } from "../../../server/raw-body.js";

/**
 * Constant-time compare over two UTF-8 strings. Length-guarded because
 * `timingSafeEqual` throws on unequal-length buffers.
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

/**
 * PagerDuty v3 signs the raw body with HMAC-SHA256; `X-PagerDuty-Signature` is a
 * comma-delimited list of `v1=<hex>` signatures (more than one during secret
 * rotation). Accept the request if any entry matches.
 */
export function verifyPagerDutySignature(
  secret: string,
  header: string | undefined,
  body: string,
): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return header.split(",").some((part) => {
    const [version, sig] = part.trim().split("=");
    return version === "v1" && !!sig && safeEqual(sig, expected);
  });
}

/** The bearer token presented via `Authorization: Bearer …` or the `?token=` fallback. */
function presentedToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (value?.startsWith("Bearer ")) return value.slice("Bearer ".length);
  const query = request.query.token;
  return typeof query === "string" ? query : undefined;
}

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

const IncidentEntrySchema = z.object({
  title: z.string().min(1).max(500),
  severity: z.string().min(1).max(100),
  date: z.string().datetime({ offset: true }),
  resolved: z.boolean(),
  url: z.string().max(2000).nullable(),
});

type IncidentEntry = z.infer<typeof IncidentEntrySchema>;

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

/**
 * Normalize a direct-format or PagerDuty/Opsgenie-envelope body into the stored
 * incident entry. Returns an `{ error }` (→ 400) on any shape violation. A
 * client-supplied `date` is validated as ISO and clamped to `now` so a future
 * timestamp cannot pin itself atop the FIFO-capped list and evict real entries.
 */
export function parseIncident(
  body: string,
  now: number,
): { error: string } | { repo: string; entry: IncidentEntry } {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { error: "invalid JSON body" };
  }
  if (!payload || typeof payload !== "object")
    return { error: "invalid payload" };

  const root = payload as Record<string, unknown>;
  const envelope =
    root.incident && typeof root.incident === "object" ? root.incident : root;
  const incident = envelope as Record<string, unknown>;
  const service = incident.service as Record<string, unknown> | undefined;

  const repo = incident.repo ?? service?.name;
  if (typeof repo !== "string" || !REPO_NAME.test(repo))
    return { error: "repo must be in owner/name form" };

  const candidate = {
    title: asString(incident.title ?? incident.summary, "Unknown incident"),
    severity: asString(incident.severity ?? incident.urgency, "unknown"),
    date:
      typeof incident.date === "string"
        ? incident.date
        : new Date(now).toISOString(),
    resolved: Boolean(incident.resolved ?? incident.status === "resolved"),
    url:
      typeof (incident.url ?? incident.html_url) === "string"
        ? (incident.url ?? incident.html_url)
        : null,
  };

  const parsed = IncidentEntrySchema.safeParse(candidate);
  if (!parsed.success) return { error: formatZodError(parsed.error) };

  const clampedMs = Math.min(Date.parse(parsed.data.date), now);
  return {
    repo,
    entry: { ...parsed.data, date: new Date(clampedMs).toISOString() },
  };
}

export function incidentWebhookRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/webhook/incident",
    // Auth-exempt from the bearer-scope strategy: this route verifies senders
    // itself (PagerDuty HMAC or an Opsgenie shared token) below.
    options: { auth: false, payload: { parse: false } },
    handler: async (request, h) => {
      const secret = process.env.LORE_INCIDENT_WEBHOOK_SECRET;
      const token = process.env.LORE_INCIDENT_WEBHOOK_TOKEN;
      if (!secret && !token)
        return h
          .response({ error: "incident webhook not configured" })
          .code(503);

      const body = rawBody(request);
      const sigHeader = request.headers["x-pagerduty-signature"];
      const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      const signatureOk =
        !!secret && verifyPagerDutySignature(secret, signature, body);
      const presented = presentedToken(request);
      const tokenOk = !!token && !!presented && safeEqual(presented, token);
      if (!signatureOk && !tokenOk)
        return h.response({ error: "unauthorized" }).code(401);

      const result = parseIncident(body, Date.now());
      if ("error" in result)
        return h.response({ error: result.error }).code(400);

      const pool = getPool();
      if (!pool) return h.response({ error: "database unavailable" }).code(503);

      try {
        await pool.query(
          `UPDATE lore.repos
           SET settings = jsonb_set(
             COALESCE(settings, '{}'),
             '{incidents}',
             (SELECT jsonb_agg(elem) FROM (
               SELECT elem FROM jsonb_array_elements(
                 COALESCE(settings->'incidents', '[]') || $2::jsonb
               ) AS elem
               ORDER BY elem->>'date' DESC
               LIMIT 10
             ) sub)
           )
           WHERE full_name = $1`,
          [result.repo, JSON.stringify(result.entry)],
        );
        return h.response({ ok: true, repo: result.repo });
      } catch (err) {
        return h
          .response({
            error: err instanceof Error ? err.message : "internal error",
          })
          .code(500);
      }
    },
  };
}
