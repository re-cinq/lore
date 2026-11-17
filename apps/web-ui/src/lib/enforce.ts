// The web-ui does not import lore-shared; this is the one guard it needs, shaped as lore-shared's `enforceTrue`.

export function enforceTrue(
  condition: unknown,
  errorType: new (message: string) => Error,
  errorMessage: string,
): asserts condition {
  if (condition) {
    return;
  }
  throw new errorType(errorMessage);
}
