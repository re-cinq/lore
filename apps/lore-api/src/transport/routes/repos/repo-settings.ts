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
import { checkApproval, type ApprovalOutcome } from "../two-key.js";
import { isAppConfigured } from "../../../outbound/github-client.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { AutoMergeSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import { KnowledgeBackendSchema } from "@re-cinq/lore-shared/knowledge-backend.js";
import {
  disarmLorePulls,
  missingPrerequisites,
} from "../../../work/repo/auto-merge-approver.js";

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

  enforceBodyInvariants(body);

  const gate = await enforceApproverGate(request, repo, body);

  if (!gate.ok) {
    return h.response(gate.body).code(gate.code);
  }

  if (approverFrom(body) === "none") {
    await disarmAutoMerge(repo);
  }
  await applyRepoUpdates(pool, repo, body);
  await handleTeamChange(pool, repo, body.team, existingTeam);

  return h.response({ ok: true });
}

async function handleTeamChange(
  pool: Pool,
  repo: string,
  bodyTeam: string | null | undefined,
  existingTeam: string | null,
): Promise<void> {
  // A changed team strands legacy org_shared chunk rows — signal the Floor to relocate them now (nightly reindex is the safety net).
  if (bodyTeam !== undefined && (bodyTeam || null) !== existingTeam) {
    await notifyTeamChanged(pool, repo);
  }
}

/** Switching to lore-reviewer needs the App, a protecting ruleset on the default branch, and the two-key ceremony. */
async function enforceApproverGate(
  request: Request,
  repo: string,
  body: RepoSettingsBody,
): Promise<{ ok: true } | ApprovalOutcome> {
  if (approverFrom(body) !== "lore-reviewer") {
    return { ok: true };
  }
  const missing = await missingPrerequisitesOf(repo);

  if (missing.length > 0) {
    return missingPrerequisitesError(missing);
  }

  return checkApproval(
    request,
    repo,
    ["auto_merge.approver"],
    "Turning auto_merge.approver on is two-key",
  );
}

async function missingPrerequisitesOf(repo: string): Promise<string[]> {
  const { pulls, repo: files } = await projectFor(repo);

  return missingPrerequisites({
    appInstalled: isAppConfigured(),
    defaultBranch: () => files.defaultBranch(),
    getBranchRule: (branch) => pulls.getBranchRule(branch),
  });
}

function approverFrom(body: RepoSettingsBody): string | undefined {
  return (body.settings?.auto_merge as { approver?: string } | undefined)
    ?.approver;
}

function enforceBodyInvariants(body: RepoSettingsBody): void {
  enforceNoDarkFactory(body);
  enforceDigestValid(
    (body.settings as { digest?: unknown } | undefined)?.digest,
  );
  const autoMerge = AutoMergeSettingsSchema.optional();

  enforceTrue(
    autoMerge.safeParse(body.settings?.auto_merge).success,
    apiError(400),
    "auto_merge.approver must be none or lore-reviewer",
  );
  const contextBackend = KnowledgeBackendSchema.optional();

  enforceTrue(
    contextBackend.safeParse(body.settings?.context_backend).success,
    apiError(400),
    "context_backend must be lore, utopia or both",
  );
}

/** `error` is the sentence the settings page shows; `missing` lists the gaps for a client that wants them one by one. */
function missingPrerequisitesError(missing: string[]): ApprovalOutcome {
  return {
    ok: false,
    code: 403,
    body: {
      error: `Cannot enable lore-reviewer. Missing: ${missing.join(", ")}`,
      code: "missing_prerequisites",
      missing,
    },
  };
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

/** A failed disarm never blocks the switch to none: none is the safe state, and the PR is named in the log for a person to disarm by hand. */
async function disarmAutoMerge(repo: string): Promise<void> {
  const { pulls, audit } = await projectFor(repo);
  const failed = await disarmLorePulls({
    pulls,
    audit,
    appLogin: await loreAppLogin(),
  });

  if (failed.length > 0) {
    console.error(
      `[settings] could not disarm auto-merge on ${repo} PRs ${failed.join(", ")}`,
    );
  }
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
