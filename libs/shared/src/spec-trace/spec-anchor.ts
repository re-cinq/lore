/**
 * spec-traceability-graph — `path#ordinal` spec anchors carried on a
 * {@link TestDescriptor}'s `spec`. A descriptor may carry one anchor (a string)
 * or several (one test validating several statements — `string[]`);
 * {@link parseSpecAnchors} normalizes either into a list, dropping unparseable
 * entries. Extracted from `ingest-test-report.ts` so the parsing is pure and
 * unit-tested without a live Dgraph.
 */

/** A parsed `path#ordinal` spec anchor. */
export interface SpecAnchor {
  specPath: string;
  ordinal: number;
}

/**
 * Parse a `path#ordinal` anchor. Returns null for a missing anchor, a blank
 * path, or a non-integer ordinal.
 */
export function parseSpecAnchor(spec: string | undefined): SpecAnchor | null {
  if (!spec?.includes("#")) {
    return null;
  }
  const [specPath, ordinalStr] = spec.split("#");
  const ordinal = Number(ordinalStr);

  if (!specPath || !Number.isInteger(ordinal)) {
    return null;
  }

  return { specPath, ordinal };
}

/**
 * Parse a descriptor's `spec` — one anchor (string), many (`string[]`), or
 * none (undefined) — into a list of {@link SpecAnchor}, dropping any entry that
 * does not parse.
 */
export function parseSpecAnchors(
  spec: string | string[] | undefined,
): SpecAnchor[] {
  if (spec === undefined) {
    return [];
  }
  const raw = Array.isArray(spec) ? spec : [spec];

  return raw
    .map(parseSpecAnchor)
    .filter((anchor): anchor is SpecAnchor => anchor !== null);
}
