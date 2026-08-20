import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/**
 * Org-wide `lore.settings` and one repo's session count, moved out of web-ui
 * (ADR-032).
 *
 * The write is an ALLOWLIST, not a passthrough: `lore.settings` holds the ingest
 * token and the approval config, so a route that upserted any key a caller named
 * would let one invent settings the platform then reads. Three keys exist; three
 * keys are writable.
 */

const WRITABLE_KEYS = new Set(["api_url", "ingest_token", "approval_config"]);

const SettingsBody = z.object({
  entries: z
    .array(z.object({ key: z.string().min(1), value: z.string() }))
    .min(1),
});

type SettingsBody = z.infer<typeof SettingsBody>;

/** The org-wide settings document plus how many repos it governs. */
const OrgSettingsSchema = z.object({
  settings: z.record(z.unknown()),
  repo_count: z.number(),
});

const OkSchema = z.object({ ok: z.literal(true) });

/** How many developers have run a local session against a repo, and when last. */
const RepoSessionsSchema = z.object({
  devs: z.number(),
  last: z.string().nullable(),
});

export function orgSettingsRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    {
      method: "GET",
      path: "/api/settings",
      options: zodResponse(bearerScope("admin"), OrgSettingsSchema, {
        name: "OrgSettings",
        description: "Org-wide settings and the repo count they cover",
      }),
      handler: async (_request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { rows: settings } = await pool.query(
          `SELECT key, value, updated_at FROM lore.settings ORDER BY key`,
        );
        const { rows: countRows } = await pool.query<{ count: number }>(
          `SELECT count(*)::int as count FROM lore.repos`,
        );

        return h.response({
          settings,
          repo_count: countRows[0]?.count ?? 0,
        });
      },
    },

    {
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
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { entries } = request.payload as SettingsBody;

        const unknown = entries.find((entry) => !WRITABLE_KEYS.has(entry.key));

        if (unknown) {
          return h
            .response({ error: `not a writable setting: ${unknown.key}` })
            .code(400);
        }

        for (const { key, value } of entries) {
          // A blank value is "leave it alone", not "erase it": the settings form
          // posts every field every time, and an untouched secret arrives empty.
          if (!value.trim()) {
            continue;
          }
          await pool.query(
            `INSERT INTO lore.settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
            [key, value.trim()],
          );
        }

        return h.response({ ok: true });
      },
    },

    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/sessions",
      options: zodResponse(bearerScope("read"), RepoSessionsSchema, {
        name: "RepoSessions",
        description: "Local-session activity against a repo",
      }),
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const repo = `${request.params.owner}/${request.params.repo}`;
        const { rows } = await pool.query<{
          devs: number;
          last: string | null;
        }>(
          `SELECT count(DISTINCT agent_id)::int AS devs, max(created_at) AS last
             FROM memory.episodes WHERE source = 'session' AND ref = $1`,
          [repo],
        );

        return h.response(rows[0] ?? { devs: 0, last: null });
      },
    },
  ];
}
