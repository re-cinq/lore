/**
 * spec-traceability-graph — Phase 2 generation-time provenance capture.
 *
 * Lifts inline `lore:validates` annotations out of a generated code/test file
 * and returns the provenance refs that file carries. Pure: string in, refs out;
 * no Dgraph, no I/O.
 *
 * Sibling source of the same `ProvenanceRef` vocabulary is
 * `parseValidatesTrailers` in `@re-cinq/lore-shared`, which lifts the equivalent
 * links out of commit messages. `resolveProvenance` merges inline-link,
 * annotation, and trailer refs into one deduplicated list;
 * `detectProvenanceConflicts` surfaces statements that drew disagreeing targets
 * across those same sources.
 */
import { type ProvenanceRef } from "./deps.js";

/**
 * Matches a single inline annotation with the grammar
 * `<//|#> lore:validates <specPath>#<ordinal>`. Both `//` (C-style) and `#`
 * (shell/Python-style) comment markers are recognized. Capture group 1 is the
 * spec path, group 2 the (1-based) statement ordinal.
 */
const VALIDATES_ANNOTATION_RE = /(?:\/\/|#)\s*lore:validates\s+(\S+?)#(\d+)/;

/**
 * Scan `fileContent` for `// lore:validates <specPath>#<ordinal>` annotations
 * and return one `ProvenanceRef` per match. The annotated file (`filePath`) is
 * the validating `target` of every ref it carries; non-matching lines are
 * ignored and an empty result means the file declared no provenance.
 */
export function parseValidatesAnnotations(
  fileContent: string,
  filePath: string,
): ProvenanceRef[] {
  const refs: ProvenanceRef[] = [];

  for (const line of fileContent.split("\n")) {
    const match = VALIDATES_ANNOTATION_RE.exec(line);

    if (match) {
      refs.push({
        specPath: match[1],
        ordinal: Number.parseInt(match[2], 10),
        target: filePath,
      });
    }
  }

  return refs;
}

/**
 * Pair-identity key for conflict detection: two refs target the same statement
 * when their `(specPath, ordinal)` pair matches, regardless of validating target.
 */
function pairKey(ref: ProvenanceRef): string {
  return `${ref.specPath}|${ref.ordinal}`;
}

/**
 * The three provenance forms a generated file can carry, each pre-parsed into
 * refs: inline `([validated by])` spec links, `lore:validates` code annotations,
 * and `Lore-Validates:` commit trailers. Consumed by `resolveProvenance` and
 * `detectProvenanceConflicts`.
 */
export interface ProvenanceSources {
  inline?: ProvenanceRef[];
  annotation?: ProvenanceRef[];
  trailer?: ProvenanceRef[];
}

/** A provenance ref tagged with the source form it was read from. */
interface TaggedRef {
  ref: ProvenanceRef;
  source: SourceName;
}

type SourceName = "inline" | "annotation" | "trailer";

/**
 * The single canonical read order for provenance sources — inline, then
 * annotation, then trailer. Both `resolveProvenance` and
 * `detectProvenanceConflicts` flatten in this order, so it lives here once.
 */
const READ_ORDER: readonly SourceName[] = ["inline", "annotation", "trailer"];

/**
 * Flatten `sources` into one ref stream in canonical read order, each ref tagged
 * with the source form it came from. Empty/absent source arrays contribute
 * nothing.
 */
function refsInReadOrder(sources: ProvenanceSources): TaggedRef[] {
  return READ_ORDER.flatMap((source) =>
    (sources[source] ?? []).map((ref) => ({ ref, source })),
  );
}

/**
 * Source precedence, most specific first: a `lore:validates` annotation in the
 * code beats a `Lore-Validates:` commit trailer, which beats an inline
 * `([validated by])` spec link. Higher rank wins a conflict on the same pair.
 */
const SOURCE_RANK: Record<SourceName, number> = {
  annotation: 3,
  trailer: 2,
  inline: 1,
};

/**
 * Merge pre-parsed provenance refs from the inline-link, annotation, and trailer
 * forms into one list. For each `(specPath, ordinal)` pair the ref from the
 * highest-precedence source wins (annotation > trailer > inline); a rank tie
 * keeps the first-seen ref. First-appearance order of each pair is preserved.
 */
export function resolveProvenance(sources: ProvenanceSources): ProvenanceRef[] {
  const winners = new Map<string, { ref: ProvenanceRef; rank: number }>();

  for (const { ref, source } of refsInReadOrder(sources)) {
    const key = pairKey(ref);
    const rank = SOURCE_RANK[source];
    const existing = winners.get(key);

    if (!existing || rank > existing.rank) {
      winners.set(key, { ref, rank });
    }
  }

  return [...winners.values()].map((entry) => entry.ref);
}

/**
 * A `(specPath, ordinal)` statement that drew two or more distinct validating
 * targets across the provenance sources — the data-model's "provenance
 * discrepancy" surfaced as a value for the caller to log.
 */
export interface ProvenanceConflict {
  specPath: string;
  ordinal: number;
  targets: string[];
}

/**
 * Find every `(specPath, ordinal)` pair that drew two or more DISTINCT targets
 * across the sources, scanned in read order (inline, then annotation, then
 * trailer). Each conflict lists its distinct targets in first-appearance order;
 * pairs with a single target are not conflicts. First-appearance order of the
 * conflicting pairs is preserved.
 */
export function detectProvenanceConflicts(
  sources: ProvenanceSources,
): ProvenanceConflict[] {
  const pairs = new Map<string, ProvenanceConflict>();

  for (const { ref } of refsInReadOrder(sources)) {
    const key = pairKey(ref);
    const existing = pairs.get(key);

    if (!existing) {
      pairs.set(key, {
        specPath: ref.specPath,
        ordinal: ref.ordinal,
        targets: [ref.target],
      });
      continue;
    }

    if (!existing.targets.includes(ref.target)) {
      existing.targets.push(ref.target);
    }
  }

  return [...pairs.values()].filter((pair) => pair.targets.length >= 2);
}
