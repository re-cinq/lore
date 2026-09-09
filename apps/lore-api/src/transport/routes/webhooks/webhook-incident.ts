import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { formatZodError } from "../../http/zod-validate.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { OkTrue } from "../../http/ok-schema.js";

/** The incident was recorded against a repo. */
const IncidentRecordedSchema = z.object({
  ok: OkTrue,
  repo: z.string(),
});

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
    handler: (request, h) => serveIncident(getPool, request, h),
  };
}

/** A production incident from PagerDuty or Opsgenie. Recorded on the repo so context assembly can surface it at priority 1 — an agent working during an incident should know. */
async function serveIncident(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const secret = process.env.LORE_INCIDENT_WEBHOOK_SECRET;
  const token = process.env.LORE_INCIDENT_WEBHOOK_TOKEN;

  enforceTrue(
    secret || token,
    apiError(503),
    "incident webhook not configured",
  );

  const body = rawBody(request);

  enforceTrue(
    credentialsPresented(request, secret, token, body),
    apiError(401),
    "unauthorized",
  );

  return recordIncident(getPool, body, h);
}

// True when the caller presented either a valid PagerDuty HMAC signature or a matching bearer/query token.
function credentialsPresented(
  request: Request,
  secret: string | undefined,
  token: string | undefined,
  body: string,
): boolean {
  const signature = firstHeaderValue(request.headers["x-pagerduty-signature"]);
  const signatureOk =
    !!secret && verifyPagerDutySignature(secret, signature, body);
  const presented = presentedToken(request);
  const tokenOk = !!token && !!presented && safeEqual(presented, token);

  return signatureOk || tokenOk;
}

function firstHeaderValue(
  header: string | string[] | undefined,
): string | undefined {
  return Array.isArray(header) ? header[0] : header;
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

// PagerDuty HMAC-SHA256 verification; X-PagerDuty-Signature is comma-delimited v1=<hex> list.
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

// Constant-time string compare; length-guarded since timingSafeEqual throws on unequal buffers.
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);

  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

/** Parses the already-verified body and records it. Reached only after the signature check, so nothing here re-reads or re-serializes the raw payload. */
async function recordIncident(
  getPool: () => Pool | null,
  body: string,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const result = parseIncident(body, Date.now());

  // result.error exists only inside this branch; type-narrowing prevents enforce.
  if ("error" in result) {
    return h.response({ error: result.error }).code(400);
  }

  const pool = getPool();

  enforceTrue(pool, apiError(503), "database unavailable");

  return upsertIncident(pool, result, h);
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

  const validated = validatedEntry(buildIncidentCandidate(incident, now), now);

  return "error" in validated ? validated : { repo, entry: validated.entry };
}

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
  return {
    title: asString(incident.title ?? incident.summary, "Unknown incident"),
    severity: asString(incident.severity ?? incident.urgency, "unknown"),
    date: incidentDate(incident, now),
    resolved: Boolean(incident.resolved ?? incident.status === "resolved"),
    url: incidentUrl(incident),
  };
}

// ISO `date` field, else `now` (validated as ISO clamped to now downstream).
function incidentDate(incident: Record<string, unknown>, now: number): string {
  return typeof incident.date === "string"
    ? incident.date
    : new Date(now).toISOString();
}

// `url` direct, else PagerDuty's `html_url`.
function incidentUrl(incident: Record<string, unknown>): string | null {
  const url = incident.url ?? incident.html_url;

  return typeof url === "string" ? url : null;
}

// Validates the candidate and clamps its date to now, so a future-dated incident cannot evict the real ones.
function validatedEntry(
  candidate: IncidentCandidate,
  now: number,
): { error: string } | { entry: IncidentEntry } {
  const parsed = IncidentEntrySchema.safeParse(candidate);

  if (!parsed.success) {
    return { error: formatZodError(parsed.error) };
  }

  const clampedMs = Math.min(Date.parse(parsed.data.date), now);

  return { entry: { ...parsed.data, date: new Date(clampedMs).toISOString() } };
}

async function upsertIncident(
  pool: Pool,
  result: { repo: string; entry: IncidentEntry },
  h: ResponseToolkit,
) {
  try {
    await appendIncident(pool, result.repo, result.entry);

    return h.response({ ok: true, repo: result.repo });
  } catch (err) {
    return h
      .response({
        error: err instanceof Error ? err.message : "internal error",
      })
      .code(500);
  }
}

const APPEND_INCIDENT_SQL = `UPDATE lore.repos
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
             WHERE full_name = $1`;

// Upserts the parsed incident onto the repo's FIFO-capped settings list.
/** Appends the incident and keeps only the ten most recent. Capped in SQL rather than in code because the settings blob is read on every context assembly — an unbounded incident list would grow into every agent's prompt budget. */
async function appendIncident(
  pool: Pool,
  repo: string,
  entry: IncidentEntry,
): Promise<void> {
  await pool.query(APPEND_INCIDENT_SQL, [repo, JSON.stringify(entry)]);
}
