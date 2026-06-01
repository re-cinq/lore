/**
 * True when a Kubernetes API error means "the object already exists" (HTTP 409
 * / reason AlreadyExists). The `@kubernetes/client-node` ApiException surfaces
 * the status inconsistently — sometimes `code`, sometimes `statusCode`, sometimes
 * only inside a stringified body ("HTTP-Code: 409 ... Unknown API Status Code!").
 * Reconcile races re-create the same Job, so this case is benign and must not be
 * reported as a task failure.
 */
export function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: unknown;
    statusCode?: unknown;
    response?: { statusCode?: unknown };
    body?: { code?: unknown; reason?: unknown };
    message?: unknown;
  };

  if (e.code === 409 || e.statusCode === 409 || e.response?.statusCode === 409) return true;
  if (e.body && (e.body.code === 409 || e.body.reason === "AlreadyExists")) return true;

  const message = typeof e.message === "string" ? e.message : "";
  return /already exists/i.test(message) || /AlreadyExists/.test(message);
}
