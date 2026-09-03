import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import type {
  Request,
  ResponseToolkit,
  ResponseObject,
  ServerRoute,
} from "@hapi/hapi";
import {
  parseDarkFactorySettings,
  parseTaskOverrides,
  twoKeyFieldsTouched,
  type DarkFactorySettings,
  type TaskOverridesPatch,
} from "../../../features/dark-factory/dark-factory-settings.js";
import { PgBaseline } from "@re-cinq/lore-shared/project/baseline/baseline-pg.js";
import {
  captureBaselineForRepo,
  shouldCaptureBaseline,
} from "../../../features/dark-factory/baseline-capture.js";
import { projectFor } from "../../../platform/project-boot.js";
import { z } from "zod";
import { ResolvedDarkFactorySettingsSchema } from "@re-cinq/lore-shared/models/dark-factory-settings.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { checkApproval } from "../two-key.js";

const DF_PATH = "/api/repos/{owner}/{repo}/settings/dark-factory";
const repoOf = (params: Record<string, string>) =>
  `${params.owner}/${params.repo}`;

type Ceremony = {
  tier: "two_key" | "admin";
  pr_ref?: string;
  approver?: string;
  pr_url?: string;
};

/**
 * The dark-factory settings surface. The READ is the fully resolved block — the
 * model's own resolved projection, so the published contract and the resolver
 * cannot disagree about which knobs exist. The WRITE echoes what it applied plus
 * the ceremony that authorised it (ADR-016's two-key gate).
 */
const DarkFactoryAppliedSchema = z.object({
  ok: z.literal(true),
  applied: ResolvedDarkFactorySettingsSchema,
  ceremony: z.object({
    tier: z.enum(["two_key", "admin"]),
    pr_ref: z.string().optional(),
    approver: z.string().optional(),
  }),
});

/**
 * GET reads, PUT writes, and each declares its own shape.
 *
 * This was ONE `method: "*"` route, so the generator — which stamps a contract
 * per route and applies it to every verb that route serves — could only declare
 * the union of the two, leaving a generated client to narrow "resolved settings
 * or applied change" on a verb that only ever answers one of them.
 *
 * The wildcard route stays as a FALLBACK, and only for the 405: hapi answers an
 * unmatched verb on a matched path with 404, and "you may not DELETE this" is a
 * better answer than "there is nothing here". It declares no contract, so it
 * contributes no operation to the document.
 *
 * Each route takes the handler for its own verb. Re-dispatching on
 * `request.method` under three routes that each serve one verb would leave two
 * arms dead on every request and the 405 arm unreachable from the two that
 * matter — the split is what makes the dispatch unnecessary. The 405 no longer
 * waits on the pool either: refusing a verb needs no database.
 */
export function darkFactoryRoute(getPool: () => Pool | null): ServerRoute[] {
  /** Both real verbs need the pool — the GET reads settings through a project
   *  bound to it — so the one guard is stated once and each verb receives it. */
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
    // A guard's refusal already carries its status; only an unexpected failure
    // is this block's to shape.
    rethrowBoom(err);

    console.error("[dark-factory] GET settings failed:", err);

    return h.response({ error: "internal" }).code(500);
  }
}

/** Deep-merges one task-type override patch (and its nested `execution`) over the stored entry. */
function mergedTaskOverride(
  prev: Record<string, unknown> | undefined,
  patch: TaskOverridesPatch[string],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(prev ?? {}), ...patch };

  if (patch.execution) {
    const prevExecution = (prev?.execution ?? {}) as Record<string, unknown>;

    merged.execution = { ...prevExecution, ...patch.execution };
  }

  return merged;
}

async function handlePut(
  request: Request,
  h: ResponseToolkit,
  pool: Pool,
  repo: string,
): Promise<ResponseObject> {
  // hapi parses the payload natively (ADR-034); malformed JSON is a 400 and an
  // oversized body a 413 before we get here. Empty body → {} (no-op patch).
  const body = request.payload ?? {};

  let patch: DarkFactorySettings;
  let toPatch: TaskOverridesPatch | undefined;

  try {
    patch = parseDarkFactorySettings(body);
    // Optional sibling: per-task-type overrides. `execution.image` here is
    // two-key gated like dark_factory.execution.image (ADR-025).
    const rawTo = (body as { task_overrides?: unknown } | null)?.task_overrides;

    toPatch = rawTo !== undefined ? parseTaskOverrides(rawTo) : undefined;
  } catch (err) {
    const issues =
      typeof err === "object" && err !== null && "issues" in err
        ? (err as { issues: unknown }).issues
        : (err as Error).message;

    return h.response({ error: "invalid_settings", issues }).code(400);
  }

  // Two-key check (FR3.9): privileged fields require an approval-PR header.
  const twoKey = twoKeyFieldsTouched(patch, toPatch);
  const gate =
    twoKey.length > 0
      ? await checkApproval(
          request,
          repo,
          twoKey,
          "Privileged fields require an X-Lore-Approval-PR header. " +
            "Reference an open PR labeled `dark-factory-approval` by a CODEOWNER.",
        )
      : null;

  if (gate && !gate.ok) {
    return h.response(gate.body).code(gate.code);
  }

  const ceremony: Ceremony = gate?.ok
    ? {
        tier: "two_key",
        pr_ref: gate.evidence.prRef,
        approver: gate.evidence.approver,
        pr_url: gate.evidence.prUrl,
      }
    : { tier: "admin" };

  // Read current, merge patch, write back. lore.repos.settings is JSONB.
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
    const settings = rows[0].settings ?? {};
    const prev = settings.dark_factory ?? {};
    const next = { ...prev, ...patch };

    if (patch.auto_merge) {
      next.auto_merge = { ...(prev.auto_merge ?? {}), ...patch.auto_merge };
    }

    if (patch.execution) {
      next.execution = { ...(prev.execution ?? {}), ...patch.execution };
    }
    settings.dark_factory = next;

    // Per-task-type overrides: deep-merge each touched type (and its nested
    // `execution`) over the existing entry, leaving untouched types intact.
    const prevTo = settings.task_overrides ?? {};

    if (toPatch) {
      const nextTo: Record<string, Record<string, unknown>> = { ...prevTo };

      for (const [type, ov] of Object.entries(toPatch)) {
        nextTo[type] = mergedTaskOverride(prevTo[type], ov);
      }
      settings.task_overrides = nextTo;
    }

    await client.query(
      `UPDATE lore.repos SET settings = $1 WHERE full_name = $2`,
      [settings, repo],
    );

    // Audit log entry per FR3.9.
    const auditPayload = {
      field_paths_changed: [
        ...Object.keys(patch),
        ...(toPatch
          ? Object.keys(toPatch).map((t) => `task_overrides.${t}`)
          : []),
      ],
      two_key_fields: twoKey,
      prev: { dark_factory: prev, task_overrides: prevTo },
      next: {
        dark_factory: next,
        task_overrides: settings.task_overrides ?? prevTo,
      },
      ceremony,
    };

    await client
      .query(
        `INSERT INTO pipeline.audit_log (event_type, repo, payload) VALUES ('dark_factory_setting_changed', $1, $2)`,
        [repo, JSON.stringify(auditPayload)],
      )
      .catch(() => {
        // Audit log is best-effort; do not block the settings update.
      });

    await client.query("COMMIT");

    // The pre-enablement snapshot SC1/SC4/SC6 measure against (#1353). Taken
    // here because this write is the only moment that knows dark mode is being
    // turned ON: a schedule cannot guarantee the window is pre-enablement, and
    // one taken afterwards compares the repo against itself.
    //
    // After COMMIT and best-effort: the settings change is the user's request
    // and a failed snapshot must not roll it back or 500 the response.
    if (shouldCaptureBaseline(prev, next)) {
      await captureBaselineForRepo(repo, new PgBaseline(pool))
        .then((summary) => console.log(`[dark-factory] ${summary}`))
        .catch((err: unknown) =>
          console.error(
            `[dark-factory] baseline capture failed for ${repo}:`,
            err,
          ),
        );
    }

    return h.response({ ok: true, applied: next, ceremony });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[dark-factory] PUT settings failed:", err);

    return h.response({ error: "internal" }).code(500);
  } finally {
    client.release();
  }
}
