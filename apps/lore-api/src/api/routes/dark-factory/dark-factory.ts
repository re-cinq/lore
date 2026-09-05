import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool, PoolClient } from "pg";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import type {
  Request,
  ResponseToolkit,
  ResponseObject,
  ServerRoute,
} from "@hapi/hapi";
import { twoKeyFieldsTouched } from "../../../features/dark-factory/dark-factory-settings.js";
import { PgBaseline } from "@re-cinq/lore-shared/project/baseline/baseline-pg.js";
import {
  captureBaselineForRepo,
  shouldCaptureBaseline,
} from "../../../features/dark-factory/baseline-capture.js";
import type { DarkFactoryState } from "../../../features/dark-factory/baseline-capture.js";
import { projectFor } from "../../../platform/project-boot.js";
import { z } from "zod";
import { ResolvedDarkFactorySettingsSchema } from "@re-cinq/lore-shared/models/dark-factory-settings.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
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
export function darkFactoryRoute(getPool: () => Pool | null): ServerRoute[] {
  /** Both real verbs need the pool, so the guard is stated once. */
  const withPool =
    (
      serve: (
        request: Request,
        h: ResponseToolkit,
        pool: Pool,
        repo: string,
      ) => Promise<ResponseObject>,
    ) =>
    async (request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      return pool
        ? serve(request, h, pool, repoOf(request.params))
        : h.response({ error: "database unavailable" }).code(503);
    };

  return [
    {
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
      handler: withPool((_request, h, _pool, repo) => handleGet(repo, h)),
    },
    {
      method: "PUT",
      path: DF_PATH,
      options: zodResponse(bearerScope("admin"), DarkFactoryAppliedSchema, {
        name: "DarkFactorySettingsApplied",
        description: "What the write applied, and under whose authority",
        errors: [400, 409],
      }),
      handler: withPool(handlePut),
    },
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

/** Two-key check (FR3.9): privileged fields require an approval-PR header. */
async function resolveCeremony(
  request: Request,
  repo: string,
  twoKey: string[],
): Promise<CeremonyOutcome> {
  if (twoKey.length === 0) {
    return { ok: true, ceremony: { tier: "admin" } };
  }

  const gate = await checkApproval(
    request,
    repo,
    twoKey,
    "Privileged fields require an X-Lore-Approval-PR header. " +
      "Reference an open PR labeled `dark-factory-approval` by a CODEOWNER.",
  );

  return gate.ok
    ? {
        ok: true,
        ceremony: {
          tier: "two_key",
          pr_ref: gate.evidence.prRef,
          approver: gate.evidence.approver,
          pr_url: gate.evidence.prUrl,
        },
      }
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

  return await writeSettings({
    pool,
    repo,
    h,
    twoKey,
    ceremony: outcome.ceremony,
    ...parsed,
  });
}

interface SettingsWrite extends SettingsPatch {
  pool: Pool;
  repo: string;
  h: ResponseToolkit;
  twoKey: string[];
  ceremony: Ceremony;
}

/** Read current, merge patch, write back, audit — under one row lock, because two concurrent PUTs to the same repo would otherwise each write a merge of the state they read. lore.repos.settings is JSONB. */
async function writeSettings(write: SettingsWrite): Promise<ResponseObject> {
  const { pool, repo, h, patch, toPatch } = write;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT settings FROM lore.repos WHERE full_name = $1 FOR UPDATE`,
      [repo],
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");

      return h.response({ error: "repo not onboarded", repo }).code(404);
    }
    const applied = applyPatch(rows[0].settings, patch, toPatch);

    await client.query(
      `UPDATE lore.repos SET settings = $1 WHERE full_name = $2`,
      [applied.settings, repo],
    );
    await auditChange(client, write, {
      prev: applied.prev,
      next: {
        dark_factory: applied.next,
        task_overrides: applied.settings.task_overrides,
      },
    });
    await client.query("COMMIT");
    await captureBaselineIfEnabling(
      repo,
      pool,
      applied.prev.dark_factory,
      applied.next,
    );

    return h.response({
      ok: true,
      applied: applied.next,
      ceremony: write.ceremony,
    });
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
