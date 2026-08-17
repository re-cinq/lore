import type { PrivilegedPatch } from "./settings-form";

// Server-to-server client for the mcp-server's two-key-gated dark-factory
// settings endpoint. Privileged fields (dark_factory.enabled, auto_merge.paths,
// require_* downgrades, execution.image — per-repo and per-task-type) cannot be
// written directly to the DB; they must pass `twoKeyFieldsTouched` + the
// CODEOWNERS-approval ceremony, which only the mcp route enforces.

export type PrivilegedSaveResult =
  | { status: "ok"; applied: unknown; ceremony: unknown }
  | { status: "two_key_required"; fieldPaths: string[]; detail: string }
  | { status: "codeowners_failed"; code: string; detail: string }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

/**
 * Flattens the {dark_factory, task_overrides} patch into the request body the
 * gated route expects: dark_factory fields live at the top level, task_overrides
 * is a sibling key.
 */
export function privilegedRequestBody(
  patch: PrivilegedPatch,
): Record<string, unknown> {
  return {
    ...(patch.dark_factory ?? {}),
    ...(patch.task_overrides ? { task_overrides: patch.task_overrides } : {}),
  };
}

/** True when the patch carries no privileged change — skip the gated call. */
export function isEmptyPatch(patch: PrivilegedPatch): boolean {
  return !patch.dark_factory && !patch.task_overrides;
}

export async function putPrivilegedSettings(
  repo: string,
  patch: PrivilegedPatch,
  approvalPr?: string,
): Promise<PrivilegedSaveResult> {
  const apiUrl = process.env.LORE_API_URL;
  const token = process.env.LORE_ADMIN_TOKEN;

  if (!apiUrl || !token) {
    return { status: "unconfigured" };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };

  if (approvalPr) {
    headers["x-lore-approval-pr"] = approvalPr;
  }

  let res: Response;

  try {
    res = await fetch(`${apiUrl}/api/repos/${repo}/settings/dark-factory`, { signal: AbortSignal.timeout(15_000),
      method: "PUT",
      headers,
      body: JSON.stringify(privilegedRequestBody(patch)),
      cache: "no-store",
    });
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  const data = await res.json().catch(() => ({}));

  if (res.ok) {
    return { status: "ok", applied: data.applied, ceremony: data.ceremony };
  }

  if (res.status === 403 && data.error === "two_key_required") {
    return {
      status: "two_key_required",
      fieldPaths: data.field_paths ?? [],
      detail: data.detail ?? "",
    };
  }

  if (res.status === 403 && data.error === "codeowners_check_failed") {
    return {
      status: "codeowners_failed",
      code: data.code ?? "unknown",
      detail: data.detail ?? "",
    };
  }

  return {
    status: "error",
    message: data.error || data.detail || `HTTP ${res.status}`,
  };
}
