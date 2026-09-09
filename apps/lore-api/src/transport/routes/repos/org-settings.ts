import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { withPool } from "../with-pool.js";
import { OkSchema } from "../../http/ok-schema.js";

// Org-wide `lore.settings` (ADR-032); the write is an ALLOWLIST, not a passthrough — an open upsert would let a caller invent settings the platform then reads.

const WRITABLE_KEYS = new Set(["api_url", "ingest_token", "approval_config"]);

const SettingsBody = z.object({
  entries: z
    .array(z.object({ key: z.string().min(1), value: z.string() }))
    .min(1),
});

type SettingsBody = z.infer<typeof SettingsBody>;

/** The org-wide settings document plus how many repos it governs. */
const OrgSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
  repo_count: z.number(),
});

/** How many developers have run a local session against a repo, and when last. */
const RepoSessionsSchema = z.object({
  devs: z.number(),
  last: z.string().nullable(),
});

export function orgSettingsRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    readOrgSettingsRoute(getPool),

    writeOrgSettingsRoute(getPool),

    repoSessionsRoute(getPool),
  ];
}

function readOrgSettingsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/settings",
    options: zodResponse(bearerScope("admin"), OrgSettingsSchema, {
      name: "OrgSettings",
      description: "Org-wide settings and the repo count they cover",
    }),
    handler: async (_request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      return h.response(await readOrgSettings(pool));
    },
  };
}

/** The stored settings rows alongside the number of repos they govern. */
async function readOrgSettings(
  pool: Pool,
): Promise<{ settings: unknown[]; repo_count: number }> {
  const { rows: settings } = await pool.query(
    `SELECT key, value, updated_at FROM lore.settings ORDER BY key`,
  );
  const { rows: countRows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int as count FROM lore.repos`,
  );

  return { settings, repo_count: countRows[0]?.count ?? 0 };
}

function writeOrgSettingsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "PUT",
    path: "/api/settings",
    options: zodResponse(
      {
        ...bearerScope("admin"),
        validate: { payload: zodValidate(SettingsBody) },
      },
      OkSchema,
      { name: "OrgSettingsSaved", description: "The settings were written" },
    ),
    handler: withPool(getPool, serveOrgSettingsWrite),
  };
}

/** Writes the org-wide settings every repo inherits where it has not overridden them. */
async function serveOrgSettingsWrite(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { entries } = request.payload as SettingsBody;

  const unknown = entries.find((entry) => !WRITABLE_KEYS.has(entry.key));

  if (unknown) {
    return h
      .response({ error: `not a writable setting: ${unknown.key}` })
      .code(400);
  }

  await applySettingEntries(pool, entries);

  return h.response({ ok: true });
}

/** Upserts each posted entry, skipping the blanks the form re-posts for untouched fields. */
async function applySettingEntries(
  pool: Pool,
  entries: SettingsBody["entries"],
): Promise<void> {
  for (const { key, value } of entries) {
    // A blank value is "leave it alone", not "erase it" — the form posts every field every time.
    if (!value.trim()) {
      continue;
    }
    await pool.query(
      `INSERT INTO lore.settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, value.trim()],
    );
  }
}

function repoSessionsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/sessions",
    options: zodResponse(bearerScope("read"), RepoSessionsSchema, {
      name: "RepoSessions",
      description: "Local-session activity against a repo",
    }),
    handler: withPool(getPool, serveRepoSessions),
  };
}

/** How many distinct developers ran a local session against this repo, and when the last one was. */
async function serveRepoSessions(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = `${request.params.owner}/${request.params.repo}`;
  const { rows } = await pool.query<{ devs: number; last: string | null }>(
    `SELECT count(DISTINCT agent_id)::int AS devs, max(created_at) AS last
       FROM memory.episodes WHERE source = 'session' AND ref = $1`,
    [repo],
  );

  return h.response(rows[0] ?? { devs: 0, last: null });
}
