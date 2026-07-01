/**
 * `enforce` — the bouncer at the door (cf. D's `std.exception.enforce`). Prefer
 * it over an `if (!x) throw` guard block: it reads as a precondition, throws when
 * the condition is falsy, and narrows the checked expression via the assertion
 * signature so the happy path keeps the tightened type.
 */

/**
 * Throw when `condition` is falsy. The failure value is a message (wrapped in an
 * `Error`), an `Error`, or a thunk producing one — use the thunk when building
 * the error is non-trivial (e.g. a Boom carrying an HTTP status) so it is only
 * constructed on failure.
 *
 * @example
 *   enforceTrue(secret, () => Boom.serverUnavailable("secret not configured"));
 *   enforceTrue(pool, "DB pool not initialized — call initPool() first");
 *   // `secret` / `pool` are narrowed to non-nullish below this line.
 */
export function enforceTrue(
  condition: unknown,
  error: string | Error | (() => Error),
): asserts condition {
  if (condition) return;
  throw typeof error === "string"
    ? new Error(error)
    : typeof error === "function"
      ? error()
      : error;
}

/**
 * Enforce the `ok` branch of a discriminated `{ ok: true } | { ok: false }`
 * result, building the thrown error from the **failure branch** — which an
 * {@link enforceTrue} thunk cannot reach, since the failure fields only exist
 * once the result is narrowed. Narrows `result` to its ok branch for the caller.
 *
 * @example
 *   enforceOk(mapCiIngest(body), (f) => new Boom.Boom(f.error, { statusCode: f.status }));
 *   // `mapped.events` is now accessible below this line.
 */
export function enforceOk<R extends { ok: boolean }>(
  result: R,
  toError: (failure: Extract<R, { ok: false }>) => Error,
): asserts result is Extract<R, { ok: true }> {
  if (result.ok) return;
  throw toError(result as Extract<R, { ok: false }>);
}
