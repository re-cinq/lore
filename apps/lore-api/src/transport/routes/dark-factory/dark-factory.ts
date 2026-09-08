import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool, PoolClient } from "pg";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  Request,
  ResponseToolkit,
  ResponseObject,
  ServerRoute,
} from "@hapi/hapi";
import { twoKeyFieldsTouched } from "../../../work/dark-factory/dark-factory-settings.js";
import { PgBaseline } from "@re-cinq/lore-shared/project/baseline/baseline-pg.js";
import {
  captureBaselineForRepo,
  shouldCaptureBaseline,
} from "../../../work/dark-factory/baseline-capture.js";
import type { DarkFactoryState } from "../../../work/dark-factory/baseline-capture.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { z } from "zod";
import { ResolvedDarkFactorySettingsSchema } from "@re-cinq/lore-shared/models/dark-factory-settings.js";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { checkApproval } from "../two-key.js";
import {
  applyPatch,
  parseSettingsBody,
  type SettingsPatch,
} from "./dark-factory-merge.js";

const DF_PATH = "/api/repos/{owner}/{repo}/settings/dark-factory";
const repoOf = (params: Record<string, string>) =>
  `${params.owner}/${params.repo}`;

type Ceremony = {
  tier: "two_key" | "admin";
  pr_ref?: string;
  approver?: string;
  pr_url?: string;
};

/** The WRITE echoes what it applied plus the two-key ceremony that authorised it (ADR-016). */
const DarkFactoryAppliedSchema = z.object({
  ok: z.literal(true),
  applied: ResolvedDarkFactorySettingsSchema,
  ceremony: z.object({
    tier: z.enum(["two_key", "admin"]),
    pr_ref: z.string().optional(),
    approver: z.string().optional(),
  }),
});

/** One route per verb so each declares its own contract; the wildcard route exists only to answer 405 instead of hapi's 404. */
/** Both real verbs need the pool, so the guard is stated once. */
function withPool(
  getPool: () => Pool | null,
  serve: (
    request: Request,
    h: ResponseToolkit,
    pool: Pool,
    repo: string,
  ) => Promise<ResponseObject>,
) {
  return async (request: Request, h: ResponseToolkit) => {
    const pool = getPool();

    return pool
      ? serve(request, h, pool, repoOf(request.params))
      : h.response({ error: "database unavailable" }).code(503);
  };
}

/** Reads every knob RESOLVED — defaults merged in — so a caller sees what is in force rather than what happens to be stored. */
function readRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: DF_PATH,
    options: zodResponse(
      bearerScope("admin"),
      ResolvedDarkFactorySettingsSchema,
      {
        name: "DarkFactorySettings",
        description: "Every dark-factory knob, resolved",
      },
    ),
    handler: withPool(getPool, (_request, h, _pool, repo) =>
      handleGet(repo, h),
    ),
  };
}

/** The write. Its 409 is the two-key gate: a privileged field needs admin scope AND a CODEOWNER-approved PR, so a refusal here is an authorization answer rather than a validation one. */
function writeRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "PUT",
    path: DF_PATH,
    options: zodResponse(bearerScope("admin"), DarkFactoryAppliedSchema, {
      name: "DarkFactorySettingsApplied",
      description: "What the write applied, and under whose authority",
      errors: [400, 409],
    }),
    handler: withPool(getPool, handlePut),
  };
}

export function darkFactoryRoute(getPool: () => Pool | null): ServerRoute[] {
  return [
    readRoute(getPool),
    writeRoute(getPool),
    {
      // Fallback only — a concrete verb above always wins in hapi.
      method: "*",
      path: DF_PATH,
      options: bearerScope("admin"),
      handler: (_request: Request, h: ResponseToolkit) =>
        h.response({ error: "method not allowed" }).code(405),
    },
  ];
}

async function handleGet(
  repo: string,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const project = await projectFor(repo);
    const settings = await project.settings.resolveOrNull();

    enforceTrue(
      settings !== null,
      apiError(404, { repo }),
      "repo not onboarded",
    );

    return h.response(settings);
  } catch (err) {
    // A guard's refusal already carries its status; only an unexpected failure is shaped here.
    rethrowBoom(err);

    console.error("[dark-factory] GET settings failed:", err);

    return h.response({ error: "internal" }).code(500);
  }
}

type CeremonyOutcome =
  { ok: true; ceremony: Ceremony } | { ok: false; body: object; code: number };

const TWO_KEY_DETAIL =
  "Privileged fields require an X-Lore-Approval-PR header. " +
  "Reference an open PR labeled `dark-factory-approval` by a CODEOWNER.";

/** The approval PR that carried the second key, recorded so the audit row names who authorized the change. */
function twoKeyCeremony(evidence: {
  prRef: string;
  approver: string;
  prUrl: string;
}): Ceremony {
  return {
    tier: "two_key",
    pr_ref: evidence.prRef,
    approver: evidence.approver,
    pr_url: evidence.prUrl,
  };
}

/** Two-key check (FR3.9): privileged fields require an approval-PR header. */
async function resolveCeremony(
  request: Request,
  repo: string,
  twoKey: string[],
): Promise<CeremonyOutcome> {
  if (twoKey.length === 0) {
    return { ok: true, ceremony: { tier: "admin" } };
  }

  const gate = await checkApproval(request, repo, twoKey, TWO_KEY_DETAIL);

  return gate.ok
    ? { ok: true, ceremony: twoKeyCeremony(gate.evidence) }
    : { ok: false, body: gate.body, code: gate.code };
}

async function handlePut(
  request: Request,
  h: ResponseToolkit,
  pool: Pool,
  repo: string,
): Promise<ResponseObject> {
  // hapi already rejected malformed (400) and oversized (413) bodies (ADR-034); empty body is a no-op patch.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hapi types omit it, but request.payload is genuinely null for an empty body.
  const parsed = parseSettingsBody(request.payload ?? {});

  if ("error" in parsed) {
    return h.response(parsed.error).code(400);
  }

  const twoKey = twoKeyFieldsTouched(parsed.patch, parsed.toPatch);
  const outcome = await resolveCeremony(request, repo, twoKey);

  if (!outcome.ok) {
    return h.response(outcome.body).code(outcome.code);
  }

  const write = { pool, repo, h, twoKey, ...parsed };

  return await writeSettings({ ...write, ceremony: outcome.ceremony });
}

interface SettingsWrite extends SettingsPatch {
  pool: Pool;
  repo: string;
  h: ResponseToolkit;
  twoKey: string[];
  ceremony: Ceremony;
}

/** The write and its audit row, in that order and inside the same transaction. Both or neither: a settings change with no audit entry is exactly the thing the dark-factory rollback runbook cannot reconstruct. */
async function writeAndAudit(
  client: PoolClient,
  write: SettingsWrite,
  applied: ReturnType<typeof applyPatch>,
): Promise<void> {
  await client.query(
    `UPDATE lore.repos SET settings = $1 WHERE full_name = $2`,
    [applied.settings, write.repo],
  );
  await auditChange(client, write, {
    prev: applied.prev,
    next: {
      dark_factory: applied.next,
      task_overrides: applied.settings.task_overrides,
    },
  });
}

/** A repo with no row is not onboarded; the transaction is unwound before answering so the connection goes back clean. */
async function rollbackNotOnboarded(
  client: PoolClient,
  h: ResponseToolkit,
  repo: string,
): Promise<ResponseObject> {
  await client.query("ROLLBACK");

  return h.response({ error: "repo not onboarded", repo }).code(404);
}

/** What the caller sees once the change is durable, plus the baseline snapshot — taken AFTER the commit because it reads counters, and holding the row lock through it would serialize unrelated writes. */
async function committedResponse(
  write: SettingsWrite,
  applied: ReturnType<typeof applyPatch>,
): Promise<ResponseObject> {
  const { pool, repo, h, ceremony } = write;

  await captureBaselineIfEnabling(
    repo,
    pool,
    applied.prev.dark_factory,
    applied.next,
  );

  return h.response({ ok: true, applied: applied.next, ceremony });
}

/** The transaction itself. The row is SELECTed `FOR UPDATE` because the patch is a merge of what was read: two concurrent PUTs to one repo would otherwise each write a merge of the state they saw, and the later write would silently drop the earlier one's fields. */
async function applyUnderLock(
  client: PoolClient,
  write: SettingsWrite,
): Promise<ResponseObject> {
  const { repo, h, patch, toPatch } = write;

  await client.query("BEGIN");
  const { rows } = await client.query(
    `SELECT settings FROM lore.repos WHERE full_name = $1 FOR UPDATE`,
    [repo],
  );

  if (rows.length === 0) {
    return await rollbackNotOnboarded(client, h, repo);
  }
  const applied = applyPatch(rows[0].settings, patch, toPatch);

  await writeAndAudit(client, write, applied);
  await client.query("COMMIT");

  return await committedResponse(write, applied);
}

/** Read current, merge patch, write back, audit — under one row lock, because two concurrent PUTs to the same repo would otherwise each write a merge of the state they read. lore.repos.settings is JSONB. */
async function writeSettings(write: SettingsWrite): Promise<ResponseObject> {
  const { pool, h } = write;
  const client = await pool.connect();

  try {
    return await applyUnderLock(client, write);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[dark-factory] PUT settings failed:", err);

    return h.response({ error: "internal" }).code(500);
  } finally {
    client.release();
  }
}

/** The FR3.9 audit entry. Best-effort: a settings change the caller authorized must not fail because its own record could not be written. */
async function auditChange(
  client: PoolClient,
  write: SettingsWrite,
  states: { prev: unknown; next: unknown },
): Promise<void> {
  const payload = {
    field_paths_changed: [
      ...Object.keys(write.patch),
      ...Object.keys(write.toPatch ?? {}).map((t) => `task_overrides.${t}`),
    ],
    two_key_fields: write.twoKey,
    ...states,
    ceremony: write.ceremony,
  };

  const insert = `INSERT INTO pipeline.audit_log (event_type, repo, payload) VALUES ('dark_factory_setting_changed', $1, $2)`;

  await client
    .query(insert, [write.repo, JSON.stringify(payload)])
    .catch(() => {});
}

/** The pre-enablement snapshot SC1/SC4/SC6 measure against (#1353), taken here because this write is the only moment that knows dark mode is being turned ON — a snapshot taken later compares the repo against itself. After COMMIT and best-effort: a failed snapshot must neither roll the change back nor 500 it. */
async function captureBaselineIfEnabling(
  repo: string,
  pool: Pool,
  prev: DarkFactoryState,
  next: DarkFactoryState,
): Promise<void> {
  if (!shouldCaptureBaseline(prev, next)) {
    return;
  }
  await captureBaselineForRepo(repo, new PgBaseline(pool))
    .then((summary) => console.log(`[dark-factory] ${summary}`))
    .catch((err: unknown) =>
      console.error(`[dark-factory] baseline capture failed for ${repo}:`, err),
    );
}
