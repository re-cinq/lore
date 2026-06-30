import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { Project, AgentDefinition } from "@re-cinq/lore-shared";
import { projectFor } from "../../../platform/project-boot.js";
import { verifyApproval, TwoKeyError } from "../../../features/dark-factory/dark-factory-authz.js";
import { getOctokit } from "../../../platform/github-client.js";
import { json, readJsonBody } from "../http.js";
import { parseAgentInput, parseAgentPatch, imageFieldTouched } from "../../../features/agents/agents-schema.js";
import { agentDefToCrds } from "../../../features/agents/agent-crd.js";
import { applyAgentCrds, deleteAgentCrds } from "../../../features/agents/agent-crd-k8s.js";

/**
 * Per-repo agent definitions API. GET resolves/lists (the RUNNER fetches the
 * resolved def here via AgentDefsHttp); POST/PUT/DELETE mutate the repo's
 * project rows through project.agentDefs — no SQL in the route. The `image` field
 * is two-key gated like dark_factory.execution.image (ADR-025). Scope (read for
 * GET, admin for writes) is enforced at the dispatcher.
 */

const AGENT_DEFS_RE = /^\/api\/repos\/([^/]+)\/([^/]+)\/agent-definitions(?:\/([^/?]+))?(?:\?|$)/;

export async function handleAgentsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<void> {
  if (!pool) {
    json(res, 503, { error: "database unavailable" });
    return;
  }
  const m = req.url!.match(AGENT_DEFS_RE)!;
  const repo = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`;
  const name = m[3] ? decodeURIComponent(m[3]) : undefined;
  const method = req.method || "";

  try {
    const project = await projectFor(repo);

    if (method === "GET" && name) {
      const def = await project.agentDefs.resolve(name);
      if (!def) {
        json(res, 404, { error: "agent definition not found", name });
        return;
      }
      json(res, 200, def);
      return;
    }
    if (method === "GET") {
      json(res, 200, { agents: await project.agentDefs.list() });
      return;
    }
    if (method === "POST" || method === "PUT") {
      await handleWrite(req, res, pool, project, repo, name, method);
      return;
    }
    if (method === "DELETE" && name) {
      await project.agentDefs.delete(name);
      const crd_deleted = await deleteCatalogCrd(name);
      await audit(pool, repo, "agent_deleted", { name, crd_deleted });
      json(res, 200, { ok: true, deleted: name, crd_deleted });
      return;
    }
    json(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error("[agents] route failed:", err);
    json(res, 500, { error: "internal" });
  }
}

async function handleWrite(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool,
  project: Project,
  repo: string,
  name: string | undefined,
  method: string,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(res, 400, { error: "invalid_body", detail: (err as Error).message });
    return;
  }

  let imageTouched: boolean;
  let create: ReturnType<typeof parseAgentInput> | undefined;
  let patch: ReturnType<typeof parseAgentPatch> | undefined;
  try {
    if (method === "POST") {
      create = parseAgentInput(body);
      imageTouched = imageFieldTouched(create);
    } else {
      patch = parseAgentPatch(body);
      imageTouched = imageFieldTouched(patch);
    }
  } catch (err) {
    const issues =
      typeof err === "object" && err !== null && "issues" in err
        ? (err as { issues: unknown }).issues
        : (err as Error).message;
    json(res, 400, { error: "invalid_agent", issues });
    return;
  }

  let ceremony: { tier: "two_key" | "admin"; pr_ref?: string; approver?: string } = { tier: "admin" };
  if (imageTouched) {
    const gate = await runApprovalGate(req, res, repo);
    if (!gate.ok) return;
    ceremony = gate.ceremony;
  }

  if (method === "POST") {
    const def = await project.agentDefs.create(create!);
    const crd_applied = await applyCatalogCrd(def);
    await audit(pool, repo, "agent_created", { name: def.name, ceremony, crd_applied });
    json(res, 200, { ok: true, agent: def, ceremony, crd_applied });
    return;
  }

  if (!name) {
    json(res, 400, { error: "agent name required in path for PUT" });
    return;
  }
  const def = await project.agentDefs.update(name, patch!);
  const crd_applied = await applyCatalogCrd(def);
  await audit(pool, repo, "agent_updated", { name, ceremony, crd_applied });
  json(res, 200, { ok: true, agent: def, ceremony, crd_applied });
}

/**
 * Make the resolved recipe the source of truth by materialising its AgentDefinition +
 * Station CRDs (D2). Best-effort + reported: the Postgres write already succeeded (it
 * still serves the legacy resolve path), so a k8s hiccup surfaces as crd_applied:false
 * rather than failing the edit. Full Postgres retirement follows at cutover (#688).
 */
async function applyCatalogCrd(def: AgentDefinition): Promise<boolean> {
  if (!process.env.KUBERNETES_SERVICE_HOST) return false; // not in-cluster (local dev / tests)
  try {
    await applyAgentCrds(agentDefToCrds(def, { eventsUrl: process.env.LORE_AGENT_EVENTS_URL }));
    return true;
  } catch (err) {
    console.error(`[agents] CRD apply failed for ${def.name}:`, err);
    return false;
  }
}

async function deleteCatalogCrd(name: string): Promise<boolean> {
  if (!process.env.KUBERNETES_SERVICE_HOST) return false;
  try {
    await deleteAgentCrds(name);
    return true;
  } catch (err) {
    console.error(`[agents] CRD delete failed for ${name}:`, err);
    return false;
  }
}

/**
 * The CODEOWNERS approval-PR ceremony for the two-key `image` field — mirrors
 * the dark-factory settings gate. Writes the 403 and returns ok:false on
 * failure so the caller just returns.
 */
async function runApprovalGate(
  req: IncomingMessage,
  res: ServerResponse,
  repo: string,
): Promise<{ ok: true; ceremony: { tier: "two_key"; pr_ref?: string; approver?: string } } | { ok: false }> {
  const prRef = req.headers["x-lore-approval-pr"];
  if (typeof prRef !== "string" || !prRef) {
    json(res, 403, {
      error: "two_key_required",
      field_paths: ["image"],
      detail:
        "Changing an agent's execution image requires an X-Lore-Approval-PR header. " +
        "Reference an open PR labeled `dark-factory-approval` by a CODEOWNER.",
    });
    return { ok: false };
  }
  try {
    const octokit = await getOctokit();
    const evidence = await verifyApproval({ octokit, prRef, targetRepo: repo });
    return { ok: true, ceremony: { tier: "two_key", pr_ref: evidence.prRef, approver: evidence.approver } };
  } catch (err) {
    if (err instanceof TwoKeyError) {
      json(res, 403, { error: "codeowners_check_failed", code: err.code, detail: err.message });
      return { ok: false };
    }
    console.error("[agents] two-key verify failed:", err);
    json(res, 503, { error: "github_api_unavailable" });
    return { ok: false };
  }
}

async function audit(pool: Pool, repo: string, eventType: string, payload: unknown): Promise<void> {
  await pool
    .query(`INSERT INTO pipeline.audit_log (event_type, repo, payload) VALUES ($1, $2, $3)`, [
      eventType,
      repo,
      JSON.stringify(payload),
    ])
    .catch(() => {
      // Audit log is best-effort; never block the write.
    });
}
