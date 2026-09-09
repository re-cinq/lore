/** `path#ordinal` spec anchors (pure, unit-tested). */

/** A parsed `path#ordinal` spec anchor. */
export interface SpecAnchor {
  specPath: string;
  ordinal: number;
}

/** Parse a `path#ordinal` anchor; returns null if invalid. */
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

/** Parse a descriptor's `spec` into a list of SpecAnchors, dropping invalid entries. */
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
