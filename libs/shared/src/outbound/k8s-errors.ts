interface KubernetesErrorShape {
  code?: unknown;
  statusCode?: unknown;
  response?: { statusCode?: unknown };
  body?: { code?: unknown; reason?: unknown };
  message?: unknown;
}

function hasStatus409(e: KubernetesErrorShape): boolean {
  return (
    e.code === 409 || e.statusCode === 409 || e.response?.statusCode === 409
  );
}

function bodySaysAlreadyExists(e: KubernetesErrorShape): boolean {
  return !!e.body && (e.body.code === 409 || e.body.reason === "AlreadyExists");
}

function messageSaysAlreadyExists(e: KubernetesErrorShape): boolean {
  const message = typeof e.message === "string" ? e.message : "";

  return /already exists/i.test(message) || /AlreadyExists/.test(message);
}

/** True for a Kubernetes "already exists" (HTTP 409) error — checked loosely since ApiException surfaces the status as `code`, `statusCode`, or only inside a stringified body; benign, must not fail the task. */
export function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const e = err as KubernetesErrorShape;

  return (
    hasStatus409(e) || bodySaysAlreadyExists(e) || messageSaysAlreadyExists(e)
  );
}
