import { insertEvent } from "@re-cinq/lore-shared";
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
import { DigestSettingsSchema } from "@re-cinq/lore-shared/models/digest-settings.js";
import { withPool } from "../with-pool.js";
import { OkSchema } from "../../http/ok-schema.js";

const RepoSettingsBody = z.object({
  team: z.string().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

type RepoSettingsBody = z.infer<typeof RepoSettingsBody>;

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
    handler: withPool(getPool, serveRepoSettings),
  };
}

/** One repo's settings. Cross-repo links are bidirectional, so writing them here also updates the repo on the other side of the link. */
async function serveRepoSettings(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = `${request.params.owner}/${request.params.repo}`;
  const body = request.payload as RepoSettingsBody;
  const existingTeam = await loadRepoTeam(pool, repo);

  enforceNoDarkFactory(body);
  enforceDigestValid(
    (body.settings as { digest?: unknown } | undefined)?.digest,
  );
  await applyRepoUpdates(pool, repo, body);

  // A changed team strands legacy org_shared chunk rows — signal the Floor to relocate them now (nightly reindex is the safety net).
  if (body.team !== undefined && (body.team || null) !== existingTeam) {
    await notifyTeamChanged(pool, repo);
  }

  return h.response({ ok: true });
}

function enforceNoDarkFactory(body: RepoSettingsBody): void {
  enforceTrue(
    body.settings?.dark_factory === undefined,
    apiError(400),
    "dark_factory settings were removed on 2026-10-02",
  );
}

/** The stored team for a repo, refusing when the repo was never onboarded. */
async function loadRepoTeam(pool: Pool, repo: string): Promise<string | null> {
  const { rows } = await pool.query<{ team: string | null }>(
    `SELECT full_name, team FROM lore.repos WHERE full_name = $1`,
    [repo],
  );

  enforceTrue(rows.length !== 0, apiError(404), "Repo not found");

  return rows[0].team;
}

/** The digest block is read by a station with no user in front of it, so a malformed one (a weekday of 9, a time of "9am") is refused here rather than stored (specs/daily-digest FR1). */
function enforceDigestValid(digest: unknown): void {
  // null clears the block under the route's `||` merge; only a block that is there is checked.
  if (digest === undefined || digest === null) {
    return;
  }
  const parsed = DigestSettingsSchema.safeParse(digest);

  enforceTrue(
    parsed.success,
    apiError(400),
    `invalid digest settings: ${digestIssues(parsed.error?.issues ?? [])}`,
  );
}

function digestIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map(({ path, message }) => `${path.join(".")} ${message}`)
    .join("; ");
}

/** Writes the columns this patch touched; a patch that names none is a client error. */
async function applyRepoUpdates(
  pool: Pool,
  repo: string,
  body: RepoSettingsBody,
): Promise<void> {
  const { updates, values } = repoUpdateClauses(body);

  enforceTrue(updates.length !== 0, apiError(400), "No fields to update");
  values.push(repo);
  await pool.query(
    `UPDATE lore.repos SET ${updates.join(", ")} WHERE full_name = $${values.length}`,
    values,
  );
}

function repoUpdateClauses(body: RepoSettingsBody): {
  updates: string[];
  values: unknown[];
} {
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

  return { updates, values };
}

async function notifyTeamChanged(pool: Pool, repo: string): Promise<void> {
  try {
    // Shared writer, not a hand-rolled INSERT — it fans the event out to its subscribers.
    await insertEvent(pool, {
      eventName: "internal.repo.team_changed",
      source: "internal",
      params: { repo },
    });
  } catch (err) {
    console.error(
      `[settings] team_changed event insert failed for ${repo} (legacy rows stay in org_shared until the next team change):`,
      err,
    );
  }
}
