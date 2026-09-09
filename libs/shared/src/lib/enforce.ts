// Prefer over `if (!x) throw`: reads as a precondition and narrows via the assertion signature.

// A message-to-Error factory (`Boom.badRequest`) or an `Error` subclass.
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

// Throws `errorType(errorMessage)` when `condition` is falsy; built only on failure, so a Boom costs nothing on the happy path.
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

// Throws `errorType(result.error)` when a `{ ok }` result is not ok, else narrows `result` to its ok branch.
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
