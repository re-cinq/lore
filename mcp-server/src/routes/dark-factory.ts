import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  parseDarkFactorySettings,
  resolveSettings,
  twoKeyFieldsTouched,
  type DarkFactorySettings,
} from "../dark-factory-settings.js";
import { verifyApproval, TwoKeyError } from "../dark-factory-authz.js";
import { getOctokit } from "../github-client.js";
import { json, readJsonBody } from "./http.js";

const DARK_FACTORY_PATH_RE =
  /^\/api\/repos\/([^/]+)\/([^/]+)\/settings\/dark-factory/;

export async function handleDarkFactorySettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<void> {
  if (!pool) {
    json(res, 503, { error: "database unavailable" });
    return;
  }
  // The dispatcher only routes here on a full DARK_FACTORY_PATH_RE match.
  const m = req.url!.match(DARK_FACTORY_PATH_RE)!;
  const owner = decodeURIComponent(m[1]);
  const repoName = decodeURIComponent(m[2]);
  const repo = `${owner}/${repoName}`;
  const method = req.method || "";

  if (method === "GET") {
    await handleGetDarkFactorySettings(repo, res, pool);
    return;
  }
  if (method === "PUT") {
    await handlePutDarkFactorySettings(req, res, pool, repo);
    return;
  }
  json(res, 405, { error: "method not allowed" });
}

async function handleGetDarkFactorySettings(
  repo: string,
  res: ServerResponse,
  pool: Pool,
): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [repo],
    );
    if (rows.length === 0) {
      json(res, 404, { error: "repo not onboarded", repo });
      return;
    }
    const partial = (rows[0].settings?.dark_factory ?? null) as
      | DarkFactorySettings
      | null;
    json(res, 200, resolveSettings(partial));
  } catch (err) {
    console.error("[dark-factory] GET settings failed:", err);
    json(res, 500, { error: "internal" });
  }
}

async function handlePutDarkFactorySettings(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool,
  repo: string,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(res, 400, {
      error: "invalid_body",
      detail: (err as Error).message,
    });
    return;
  }

  let patch: DarkFactorySettings;
  try {
    patch = parseDarkFactorySettings(body);
  } catch (err) {
    const issues =
      typeof err === "object" && err !== null && "issues" in err
        ? (err as { issues: unknown }).issues
        : (err as Error).message;
    json(res, 400, { error: "invalid_settings", issues });
    return;
  }

  // Two-key check (FR3.9): privileged fields require an approval-PR header.
  const twoKey = twoKeyFieldsTouched(patch);
  let ceremony: { tier: "two_key" | "admin"; pr_ref?: string; approver?: string; pr_url?: string } = { tier: "admin" };
  if (twoKey.length > 0) {
    const prRef = req.headers["x-lore-approval-pr"];
    if (typeof prRef !== "string" || !prRef) {
      json(res, 403, {
        error: "two_key_required",
        field_paths: twoKey,
        detail:
          "Privileged fields require an X-Lore-Approval-PR header. " +
          "Reference an open PR labeled `dark-factory-approval` by a CODEOWNER.",
      });
      return;
    }
    try {
      const octokit = await getOctokit();
      const evidence = await verifyApproval({
        octokit,
        prRef,
        targetRepo: repo,
      });
      ceremony = {
        tier: "two_key",
        pr_ref: evidence.prRef,
        approver: evidence.approver,
        pr_url: evidence.prUrl,
      };
    } catch (err) {
      if (err instanceof TwoKeyError) {
        json(res, 403, {
          error: "codeowners_check_failed",
          code: err.code,
          detail: err.message,
        });
        return;
      }
      console.error("[dark-factory] Two-key verify failed:", err);
      json(res, 503, { error: "github_api_unavailable" });
      return;
    }
  }

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
      json(res, 404, { error: "repo not onboarded", repo });
      return;
    }
    const settings = rows[0].settings ?? {};
    const prev = settings.dark_factory ?? {};
    const next = { ...prev, ...patch };
    if (patch.auto_merge) {
      next.auto_merge = { ...(prev.auto_merge ?? {}), ...patch.auto_merge };
    }
    settings.dark_factory = next;

    await client.query(
      `UPDATE lore.repos SET settings = $1 WHERE full_name = $2`,
      [settings, repo],
    );

    // Audit log entry per FR3.9.
    const auditPayload = {
      field_paths_changed: Object.keys(patch),
      two_key_fields: twoKey,
      prev: prev,
      next: next,
      ceremony,
    };
    await client
      .query(
        `INSERT INTO pipeline.audit_log (event_type, repo, payload)
         VALUES ('dark_factory_setting_changed', $1, $2)`,
        [repo, JSON.stringify(auditPayload)],
      )
      .catch(() => {
        // Audit log is best-effort; do not block the settings update.
      });

    await client.query("COMMIT");
    json(res, 200, {
      ok: true,
      applied: next,
      ceremony,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[dark-factory] PUT settings failed:", err);
    json(res, 500, { error: "internal" });
  } finally {
    client.release();
  }
}
