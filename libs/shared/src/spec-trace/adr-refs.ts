/**
 * ADR reference parsing for the DECIDED_BY edge. A statement that cites an ADR
 * ("per ADR-016", "see ADR-7", "ADR-016-dark-factory") links to that ADR node
 * by number — the "why" behind the statement. Deterministic, zero-LLM.
 */

const ADR_REF = /\bADR-0*(\d+)/gi;

/** Distinct ADR numbers referenced in `text` (e.g. "per ADR-016 and ADR-7" → [16, 7]). */
export function parseAdrRefs(text: string): number[] {
  const out = new Set<number>();

  for (const m of text.matchAll(ADR_REF)) {
    out.add(parseInt(m[1], 10));
  }

  return [...out];
}

/** ADR number from a file path: "adrs/ADR-016-dark-factory.md" → 16; null when none. */
export function adrNumberFromPath(path: string): number | null {
  const m = path.match(/ADR-0*(\d+)/i);

  return m ? parseInt(m[1], 10) : null;
}
