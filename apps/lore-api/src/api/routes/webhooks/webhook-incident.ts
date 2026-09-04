import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import type { Pool } from "pg";
import type { Request, ServerRoute } from "@hapi/hapi";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { formatZodError } from "../../../server/plugins/zod-validate.js";
import { rawBody } from "../../../server/raw-body.js";

// Constant-time string compare; length-guarded since timingSafeEqual throws on unequal buffers.
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);

  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

// PagerDuty HMAC-SHA256 verification; X-PagerDuty-Signature is comma-delimited v1=<hex> list.
/** The incident was recorded against a repo. */
const IncidentRecordedSchema = z.object({
  ok: z.literal(true),
  repo: z.string(),
});

export function verifyPagerDutySignature(
  secret: string,
  header: string | undefined,
  body: string,
): boolean {
  if (!header) {
    return false;
  }
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

  if (value?.startsWith("Bearer ")) {
    return value.slice("Bearer ".length);
  }
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

type ParsedIncidentPayload =
  { ok: false; error: string } | { ok: true; root: Record<string, unknown> };

// Parses the raw body into a plain object, or an error if it isn't one.
function parseIncidentPayload(body: string): ParsedIncidentPayload {
  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, error: "invalid JSON body" };
  }

  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "invalid payload" };
  }

  return { ok: true, root: payload as Record<string, unknown> };
}

// PagerDuty/Opsgenie nest the real fields under `incident`; a direct payload is already flat.
function incidentEnvelope(
  root: Record<string, unknown>,
): Record<string, unknown> {
  const envelope =
    root.incident && typeof root.incident === "object" ? root.incident : root;

  return envelope as Record<string, unknown>;
}

// `repo` direct, else PagerDuty's `service.name`; must be `owner/name` shaped.
function incidentRepo(incident: Record<string, unknown>): string | null {
  const service = incident.service as Record<string, unknown> | undefined;
  const repo = incident.repo ?? service?.name;

  return typeof repo === "string" && REPO_NAME.test(repo) ? repo : null;
}

interface IncidentCandidate {
  title: string;
  severity: string;
  date: string;
  resolved: boolean;
  url: string | null;
}

// Maps PagerDuty/Opsgenie/direct field names onto the canonical incident shape.
function buildIncidentCandidate(
  incident: Record<string, unknown>,
  now: number,
): IncidentCandidate {
  const url = incident.url ?? incident.html_url;

  return {
    title: asString(incident.title ?? incident.summary, "Unknown incident"),
    severity: asString(incident.severity ?? incident.urgency, "unknown"),
    date:
      typeof incident.date === "string"
        ? incident.date
        : new Date(now).toISOString(),
    resolved: Boolean(incident.resolved ?? incident.status === "resolved"),
    url: typeof url === "string" ? url : null,
  };
}

// Normalize PagerDuty/Opsgenie/direct payload; validate date as ISO clamped to now to prevent eviction.
export function parseIncident(
  body: string,
  now: number,
): { error: string } | { repo: string; entry: IncidentEntry } {
  const parsedPayload = parseIncidentPayload(body);

  if (!parsedPayload.ok) {
    return { error: parsedPayload.error };
  }

  const incident = incidentEnvelope(parsedPayload.root);
  const repo = incidentRepo(incident);

  if (repo === null) {
    return { error: "repo must be in owner/name form" };
  }

  const candidate = buildIncidentCandidate(incident, now);
  const parsed = IncidentEntrySchema.safeParse(candidate);

  if (!parsed.success) {
    return { error: formatZodError(parsed.error) };
  }

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
    // Auth-exempt; senders verified by HMAC or shared token below.
    options: zodResponse(
      { auth: false, payload: { parse: false } },
      IncidentRecordedSchema,
      {
        name: "IncidentRecorded",
        description: "The incident was attached to a repo",
      },
    ),
    handler: async (request, h) => {
      const secret = process.env.LORE_INCIDENT_WEBHOOK_SECRET;
      const token = process.env.LORE_INCIDENT_WEBHOOK_TOKEN;

      enforceTrue(
        secret || token,
        apiError(503),
        "incident webhook not configured",
      );

      const body = rawBody(request);
      const sigHeader = request.headers["x-pagerduty-signature"];
      const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      const signatureOk =
        !!secret && verifyPagerDutySignature(secret, signature, body);
      const presented = presentedToken(request);
      const tokenOk = !!token && !!presented && safeEqual(presented, token);

      enforceTrue(signatureOk || tokenOk, apiError(401), "unauthorized");

      const result = parseIncident(body, Date.now());

      // result.error exists only inside this branch; type-narrowing prevents enforce.
      if ("error" in result) {
        return h.response({ error: result.error }).code(400);
      }

      const pool = getPool();

      enforceTrue(pool, apiError(503), "database unavailable");

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
