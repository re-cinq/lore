/** True for a Kubernetes "already exists" (HTTP 409) error — checked loosely since ApiException surfaces the status as `code`, `statusCode`, or only inside a stringified body; benign, must not fail the task. */
export function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as {
    code?: unknown;
    statusCode?: unknown;
    response?: { statusCode?: unknown };
    body?: { code?: unknown; reason?: unknown };
    message?: unknown;
  };

  if (
    e.code === 409 ||
    e.statusCode === 409 ||
    e.response?.statusCode === 409
  ) {
    return true;
  }

  if (e.body && (e.body.code === 409 || e.body.reason === "AlreadyExists")) {
    return true;
  }

  const message = typeof e.message === "string" ? e.message : "";

  return /already exists/i.test(message) || /AlreadyExists/.test(message);
}
