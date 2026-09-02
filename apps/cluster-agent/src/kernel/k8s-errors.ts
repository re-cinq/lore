// Reading what the apiserver actually said.
//
// The distinction these draw is load-bearing: a 404 is an ordinary absence, a
// 403 is a Role missing a rule, and everything else is a failure. Collapsing
// them — which a bare `catch` does — is how the Floor's missing `delete` verb
// stayed invisible for forty days behind 2,686 accumulated CRs.

import { errorMessage } from "@re-cinq/lore-shared";

/** The apiserver's status code, wherever this client version happens to put it. */
export function statusOf(err: unknown): number | undefined {
  const e = err as {
    code?: number;
    statusCode?: number;
    response?: { statusCode?: number };
    body?: { code?: number };
    message?: unknown;
  };
  const structured =
    e?.code ?? e?.statusCode ?? e?.response?.statusCode ?? e?.body?.code;

  if (structured !== undefined) {
    return structured;
  }

  // Last resort: the client surfaces some statuses ONLY as prose. A Secret write
  // that loses an optimistic-concurrency race arrives as
  // `HTTP-Code: 409\nMessage: Unknown API Status Code!\nBody: "{…}"` with every
  // structured field undefined — so `isConflict` said false, the retry in
  // `mutate()` that exists for exactly that race never fired, and
  // per-task-tokens 500'd whenever two agents provisioned at once (2026-08-25).
  // Anchored to the client's own prefix so an unrelated message carrying a
  // number cannot be read as a status.
  const message = typeof e?.message === "string" ? e.message : "";
  const fromMessage = /^HTTP-Code:\s*(\d{3})\b/m.exec(message);

  if (fromMessage) {
    return Number(fromMessage[1]);
  }

  // A create refused because its object is already there is a 409 with reason
  // `AlreadyExists`; this client has surfaced that as nothing but the words.
  return message.includes("already exists") ? 409 : undefined;
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

  return `${verb} agents/${name} failed with ${status ?? "no status"}${detail}: ${errorMessage(err)}`;
}

/** A 400/422 from the apiserver cannot succeed on retry — the object itself is
 *  the problem. Everything else (network, 5xx, RBAC being fixed) may. The
 *  catalog sync loop refuses-and-acks on this; forking the status set forks
 *  FR8.4's retry semantics, so the predicate lives here with its siblings. */
export function isPermanentApplyError(err: unknown): boolean {
  const status = statusOf(err);

  return status === 400 || status === 422;
}
