// Reading what the apiserver actually said — 404 is ordinary absence, 403 is a missing Role rule, everything else a failure; collapsing them (a bare catch) hid the Floor's missing delete verb for 40 days behind 2,686 CRs.

import { errorMessage } from "@re-cinq/lore-shared";

type RawK8sError =
  | {
      code?: number;
      statusCode?: number;
      response?: { statusCode?: number };
      body?: { code?: number };
      message?: unknown;
    }
  | null
  | undefined;

function directStatus(e: RawK8sError): number | undefined {
  return e?.code ?? e?.statusCode;
}

function nestedStatus(e: RawK8sError): number | undefined {
  return e?.response?.statusCode ?? e?.body?.code;
}

function structuredStatus(e: RawK8sError): number | undefined {
  return directStatus(e) ?? nestedStatus(e);
}

// Last resort: some statuses surface ONLY as prose (a lost-race Secret write's 409 had every structured field undefined, so isConflict said false — 2026-08-25).
function statusFromMessage(message: string): number | undefined {
  const fromMessage = /^HTTP-Code:\s*(\d{3})\b/m.exec(message);

  if (fromMessage) {
    return Number(fromMessage[1]);
  }

  // A create refused as already-existing is a 409 (`AlreadyExists`); this client surfaces that as nothing but the words.
  return message.includes("already exists") ? 409 : undefined;
}

/** The apiserver's status code, wherever this client version happens to put it. */
export function statusOf(err: unknown): number | undefined {
  const e = err as RawK8sError;
  const structured = structuredStatus(e);

  if (structured !== undefined) {
    return structured;
  }
  const message = typeof e?.message === "string" ? e.message : "";

  return statusFromMessage(message);
}

export function isNotFound(err: unknown): boolean {
  return statusOf(err) === 404;
}

export function isConflict(err: unknown): boolean {
  return statusOf(err) === 409;
}

/** Name the verb and the status — "Forbidden" alone does not say which Role is missing which rule. */
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

/** A 400/422 cannot succeed on retry — the object itself is the problem. The catalog sync loop refuses-and-acks on this predicate (FR8.4's retry semantics). */
export function isPermanentApplyError(err: unknown): boolean {
  const status = statusOf(err);

  return status === 400 || status === 422;
}
