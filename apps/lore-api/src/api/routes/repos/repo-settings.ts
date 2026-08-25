import { insertEvent } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  parseDarkFactorySettings,
  twoKeyFieldsTouched,
} from "../../../features/dark-factory/dark-factory-settings.js";

/**
 * `PUT /api/repos/{owner}/{repo}/settings` — the general (non-privileged) repo
 * settings write, moved out of web-ui's Next route (ADR-032).
 *
 * THE REFUSAL IS THE POINT. This merges a caller-supplied patch into
 * `lore.repos.settings`, and that JSONB also holds the dark-factory block —
 * whose privileged fields (`enabled`, `auto_merge.paths`, turning a `require_*`
 * gate off, the execution image) are guarded by a CODEOWNER-approval ceremony on
 * `PUT /settings/dark-factory`. A blanket merge here would be a way around that
 * ceremony, so a patch touching any of those fields is refused outright and
 * nothing is written — not the team, not the rest of the patch.
 */

/** Never throws: an invalid block is a client error, not a 500. */
function safeParseDarkFactory(
  raw: unknown,
):
  | { ok: true; value: ReturnType<typeof parseDarkFactorySettings> }
  | { ok: false } {
  try {
    return { ok: true, value: parseDarkFactorySettings(raw) };
  } catch {
    return { ok: false };
  }
}

const RepoSettingsBody = z.object({
  team: z.string().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

type RepoSettingsBody = z.infer<typeof RepoSettingsBody>;

const OkSchema = z.object({ ok: z.literal(true) });

export function repoSettingsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "PUT",
    path: "/api/repos/{owner}/{repo}/settings",
    options: zodResponse(
      {
        ...bearerScope("admin"),
        validate: { payload: zodValidate(RepoSettingsBody) },
      },
      OkSchema,
      {
        name: "RepoSettingsSaved",
        description: "The repo settings were written",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const repo = `${request.params.owner}/${request.params.repo}`;
      const body = request.payload as RepoSettingsBody;

      const { rows } = await pool.query<{ team: string | null }>(
        `SELECT full_name, team FROM lore.repos WHERE full_name = $1`,
        [repo],
      );

      enforceTrue(rows.length !== 0, apiError(404), "Repo not found");
      const existing = rows[0];

      const darkFactory = (body.settings as { dark_factory?: unknown })
        ?.dark_factory;

      if (darkFactory) {
        // Parse to DETECT, not to validate — but an unparseable block cannot be
        // screened for privileged fields at all, so it is refused rather than
        // merged unexamined.
        const parsed = safeParseDarkFactory(darkFactory);

        enforceTrue(parsed.ok, apiError(400), "invalid dark_factory settings");
        const touched = twoKeyFieldsTouched(parsed.value);

        enforceTrue(
          touched.length <= 0,
          apiError(403),
          `privileged dark-factory fields (${touched.join(", ")}) are written through PUT /api/repos/${repo}/settings/dark-factory, which requires the CODEOWNER approval PR`,
        );
      }

      const updates: string[] = [];
      const values: unknown[] = [];

      if (body.team !== undefined) {
        values.push(body.team || null);
        updates.push(`team = $${values.length}`);
      }

      if (body.settings !== undefined) {
        values.push(JSON.stringify(body.settings));
        // Merge, not replace: the block carries settings this route never sees.
        updates.push(
          `settings = COALESCE(settings, '{}') || $${values.length}::jsonb`,
        );
      }

      enforceTrue(updates.length !== 0, apiError(400), "No fields to update");
      values.push(repo);
      await pool.query(
        `UPDATE lore.repos SET ${updates.join(", ")} WHERE full_name = $${values.length}`,
        values,
      );

      // A changed team re-points the repo's chunk-schema resolution, stranding
      // any legacy org_shared rows. Signal the Floor so it relocates them now;
      // the nightly reindex is the safety net, so a failed insert degrades to
      // that rather than failing a write that already happened.
      if (body.team !== undefined && (body.team || null) !== existing.team) {
        try {
          // Through the shared writer, not a hand-rolled INSERT: that is what
          // fans the event out to its subscribers (libs/shared/.../fan-out.ts).
          await insertEvent(pool, {
            eventName: "internal.repo.team_changed",
            source: "internal",
            params: { repo },
          });
        } catch (err) {
          console.error(
            `[settings] team_changed event insert failed for ${repo} (nightly reindex will relocate):`,
            err,
          );
        }
      }

      return h.response({ ok: true });
    },
  };
}
