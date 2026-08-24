// Reading what the apiserver actually said.
//
// The distinction these draw is load-bearing: a 404 is an ordinary absence, a
// 403 is a Role missing a rule, and everything else is a failure. Collapsing
// them — which a bare `catch` does — is how the Floor's missing `delete` verb
// stayed invisible for forty days behind 2,686 accumulated CRs.

/** The apiserver's status code, wherever this client version happens to put it. */
export function statusOf(err: unknown): number | undefined {
  const e = err as {
    code?: number;
    statusCode?: number;
    response?: { statusCode?: number };
  };

  return e?.code ?? e?.statusCode ?? e?.response?.statusCode;
}

export function isNotFound(err: unknown): boolean {
  return statusOf(err) === 404;
}

export function isConflict(err: unknown): boolean {
  return statusOf(err) === 409;
}

/** Name the verb and the status, because "Forbidden" alone does not say which
 *  Role is missing which rule. */
export function describeK8sError(
  verb: string,
  name: string,
  err: unknown,
): string {
  const status = statusOf(err);
  const detail =
    status === 403 ? " — the cluster-agent Role is missing this rule" : "";

  return `${verb} agents/${name} failed with ${status ?? "no status"}${detail}: ${(err as Error).message}`;
}
