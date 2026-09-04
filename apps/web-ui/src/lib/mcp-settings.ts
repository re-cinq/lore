import type { PrivilegedPatch } from "./settings-form";

// Privileged fields require two-key gate + CODEOWNERS-approval ceremony.

export type PrivilegedSaveResult =
  | { status: "ok"; applied: unknown; ceremony: unknown }
  | { status: "two_key_required"; fieldPaths: string[]; detail: string }
  | { status: "codeowners_failed"; code: string; detail: string }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

/** Flatten patch into request body for gated route. */
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

function buildHeaders(
  token: string,
  approvalPr?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };

  if (approvalPr) {
    headers["x-lore-approval-pr"] = approvalPr;
  }

  return headers;
}

interface GatedResponseBody {
  applied?: unknown;
  ceremony?: unknown;
  error?: string;
  field_paths?: string[];
  code?: string;
  detail?: string;
}

function twoKeyRequiredResult(body: GatedResponseBody): PrivilegedSaveResult {
  return {
    status: "two_key_required",
    fieldPaths: body.field_paths ?? [],
    detail: body.detail ?? "",
  };
}

function codeownersFailedResult(body: GatedResponseBody): PrivilegedSaveResult {
  return {
    status: "codeowners_failed",
    code: body.code ?? "unknown",
    detail: body.detail ?? "",
  };
}

function errorResult(
  body: GatedResponseBody,
  status: number,
): PrivilegedSaveResult {
  return {
    status: "error",
    message: body.error || body.detail || `HTTP ${status}`,
  };
}

function classifyResponse(
  res: Response,
  body: GatedResponseBody,
): PrivilegedSaveResult {
  if (res.ok) {
    return { status: "ok", applied: body.applied, ceremony: body.ceremony };
  }

  if (res.status === 403 && body.error === "two_key_required") {
    return twoKeyRequiredResult(body);
  }

  if (res.status === 403 && body.error === "codeowners_check_failed") {
    return codeownersFailedResult(body);
  }

  return errorResult(body, res.status);
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

  const headers = buildHeaders(token, approvalPr);
  let res: Response;

  try {
    res = await fetch(`${apiUrl}/api/repos/${repo}/settings/dark-factory`, {
      signal: AbortSignal.timeout(15_000),
      method: "PUT",
      headers,
      body: JSON.stringify(privilegedRequestBody(patch)),
      cache: "no-store",
    });
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  const body = await res.json().catch(() => ({}));

  return classifyResponse(res, body);
}
