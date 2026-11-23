import { packRoutes } from "../pack/pack.js";
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
import { repoLevel } from "../../http/repo-guard.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { withPool } from "../with-pool.js";
import { OkSchema } from "../../http/ok-schema.js";
import {
  PACK_SYNC_KEY,
  PackSyncStateSchema,
  type PackSyncState,
} from "@re-cinq/lore-shared/models/pack-sync-state.js";
import { parsePackSync } from "@re-cinq/lore-shared/project/settings/pack-sync-store.js";
import { parseSlackUsers } from "@re-cinq/lore-shared/digest/people.js";
import {
  CONTEXT_MODEL_KEY,
  CONTEXT_PROVIDER_KEY,
  contextSettingError,
} from "@re-cinq/lore-shared/context-model.js";
import {
  SESSION_LENGTH_KEY,
  sessionLengthError,
} from "@re-cinq/lore-shared/session-length.js";

// Org-wide `lore.settings` (ADR-032); the write is an ALLOWLIST, not a passthrough — an open upsert would let a caller invent settings the platform then reads.

const WRITABLE_KEYS = new Set([
  "api_url",
  "ingest_token",
  "approval_config",
  "slack_users",
  CONTEXT_PROVIDER_KEY,
  CONTEXT_MODEL_KEY,
  SESSION_LENGTH_KEY,
]);

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
  /** What the last sync of the client's pack repo did; null while none has run (specs/client-packs). */
  pack_sync: PackSyncStateSchema.nullable(),
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

    ...packRoutes(getPool),
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

/** The stored settings rows alongside the number of repos they govern and the pack sync state among them. */
async function readOrgSettings(pool: Pool): Promise<{
  settings: unknown[];
  repo_count: number;
  pack_sync: PackSyncState | null;
}> {
  const { rows: settings } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value, updated_at FROM lore.settings ORDER BY key`,
  );
  const { rows: countRows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int as count FROM lore.repos`,
  );

  return {
    settings,
    repo_count: countRows[0]?.count ?? 0,
    pack_sync: parsePackSync(
      settings.find(({ key }) => key === PACK_SYNC_KEY)?.value ?? null,
    ),
  };
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
  const refused = refusalOf(entries);

  enforceTrue(!refused, apiError(400), refused ?? "");

  await applySettingEntries(pool, entries);

  return h.response({ ok: true });
}

/** Why a write of these entries is refused, or null: a slack_users map the digest cannot use, a context provider the builder does not know, or a session length the settings page does not offer. */
function refusalOf(entries: SettingsBody["entries"]): string | null {
  if (entries.some(isInvalidSlackUsers)) {
    return "slack_users must map GitHub logins to Slack user ids (U…)";
  }

  return (
    entries
      .map(({ key, value }) => settingError(key, value.trim()))
      .find((error) => error !== null) ?? null
  );
}

function settingError(key: string, value: string): string | null {
  return contextSettingError(key, value) ?? sessionLengthError(key, value);
}

/** The daily digest reads slack_users with no user in front of it, so a map it could not use is refused here (specs/daily-digest FR12). */
function isInvalidSlackUsers({
  key,
  value,
}: SettingsBody["entries"][number]): boolean {
  if (key !== "slack_users" || !value.trim()) {
    return false;
  }

  try {
    parseSlackUsers(value);

    return false;
  } catch {
    return true;
  }
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
    options: zodResponse(
      { ...bearerScope("read"), ...repoLevel("read") },
      RepoSessionsSchema,
      {
        name: "RepoSessions",
        description: "Local-session activity against a repo",
      },
    ),
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
