/** spec-traceability-graph Phase 2: pure generation-time provenance capture — lifts inline `lore:validates` annotations out of a generated file; sibling to commit-trailer parsing (`resolveProvenance` merges both, `detectProvenanceConflicts` finds disagreements). */
import { type ProvenanceRef } from "./deps.js";

/** Matches `<//|#> lore:validates <specPath>#<ordinal>`, both C-style and shell/Python-style comment markers. */
const VALIDATES_ANNOTATION_RE = /(?:\/\/|#)\s*lore:validates\s+(\S+?)#(\d+)/;

/** Scans `fileContent` for `lore:validates` annotations, returning one `ProvenanceRef` per match with `filePath` as the validating target. */
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

/** Pair-identity key for conflict detection: two refs target the same statement when their `(specPath, ordinal)` matches, regardless of target. */
function pairKey(ref: ProvenanceRef): string {
  return `${ref.specPath}|${ref.ordinal}`;
}

/** The three provenance forms a generated file can carry, pre-parsed into refs: inline spec links, code annotations, and commit trailers. */
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

/** The single canonical read order for provenance sources, shared by `resolveProvenance` and `detectProvenanceConflicts`. */
const READ_ORDER: readonly SourceName[] = ["inline", "annotation", "trailer"];

/** Flattens `sources` into one ref stream in canonical read order, each ref tagged with its source form. */
function refsInReadOrder(sources: ProvenanceSources): TaggedRef[] {
  return READ_ORDER.flatMap((source) =>
    (sources[source] ?? []).map((ref) => ({ ref, source })),
  );
}

/** Source precedence, most specific first: code annotation beats commit trailer beats inline spec link. Higher rank wins a conflict on the same pair. */
const SOURCE_RANK: Record<SourceName, number> = {
  annotation: 3,
  trailer: 2,
  inline: 1,
};

/** Merges pre-parsed provenance refs from all three forms into one list; for each pair, the highest-precedence source wins (a rank tie keeps first-seen). */
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

/** A `(specPath, ordinal)` statement that drew two or more distinct validating targets across sources — the "provenance discrepancy" for the caller to log. */
export interface ProvenanceConflict {
  specPath: string;
  ordinal: number;
  targets: string[];
}

/** Finds every pair that drew two or more DISTINCT targets across sources (read in canonical order); pairs with a single target are not conflicts. */
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
