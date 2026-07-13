/**
 * `enforce` — the bouncer at the door (cf. D's `std.exception.enforce`). Prefer
 * it over an `if (!x) throw` guard block: it reads as a precondition, throws when
 * the condition is falsy, and narrows the checked expression via the assertion
 * signature so the happy path keeps the tightened type.
 */

/**
 * Something that turns a message into an `Error`: a factory (`Boom.badRequest`)
 * or an `Error` subclass (`ValidationError`, `Error` itself).
 */
export type ErrorType =
  ((message: string) => Error) | (new (message: string) => Error);

function isErrorClass(
  errorType: ErrorType,
): errorType is new (message: string) => Error {
  return (
    errorType === Error ||
    (errorType as { prototype?: unknown }).prototype instanceof Error
  );
}

function buildError(errorType: ErrorType, message: string): Error {
  return isErrorClass(errorType) ? new errorType(message) : errorType(message);
}

/**
 * Throw `errorType(errorMessage)` when `condition` is falsy. The error is built
 * only on failure, so a Boom carrying an HTTP status costs nothing on the happy
 * path.
 *
 * @example
 *   enforceTrue(secret, Boom.serverUnavailable, "secret not configured");
 *   enforceTrue(pool, Error, "DB pool not initialized — call initPool() first");
 *   // `secret` / `pool` are narrowed to non-nullish below this line.
 */
export function enforceTrue(
  condition: unknown,
  errorType: ErrorType,
  errorMessage: string,
): asserts condition {
  if (condition) {
    return;
  }
  throw buildError(errorType, errorMessage);
}

/**
 * Enforce the `ok` branch of a discriminated `{ ok: true } | { ok: false;
 * error: string }` result: throw `errorType(result.error)` when it is not ok,
 * and narrow `result` to its ok branch for the caller. The `.error` read
 * happens here, inside the narrowed branch — the one place it is type-legal.
 *
 * @example
 *   const mapped = mapCiIngest(body);
 *   enforceOk(mapped, Boom.badRequest);
 *   // `mapped.events` is now accessible below this line.
 */
export function enforceOk<
  R extends { ok: true } | { ok: false; error: string },
>(
  result: R,
  errorType: ErrorType = Error,
): asserts result is Extract<R, { ok: true }> {
  if (result.ok) {
    return;
  }
  throw buildError(errorType, result.error);
}
