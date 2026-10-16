// Grading one document on Lore's assembly and Utopia's side by side (specs/context-evals FR4.5, FR4.6): how far the two stores' sources overlap and which of them alone let the question be answered.

import type { KnowledgeBackend } from "@re-cinq/lore-shared/knowledge-backend.js";
import type { AssembledSource } from "./evaluate-document.js";

/** One store's grade of a document in a side-by-side eval, with how long its assembly took. */
export interface BackendVerdict {
  found: boolean;
  answered: boolean;
  useful_share: number;
  reason: string;
  model: string;
  latency_ms: number;
}

/** A document graded on Lore's assembly and Utopia's for the same question, each at the full budget. */
export interface SideBySideEval {
  path: string;
  question: string;
  lore: BackendVerdict;
  utopia: BackendVerdict;
  /** Jaccard of the two assemblies' source paths, to two decimals. */
  top_k_overlap: number;
  /** The store whose assembly alone let the question be answered; null when both or neither did. */
  only_answered_by: SingleBackend | null;
}

export type SingleBackend = Exclude<KnowledgeBackend, "both">;

type Answered = Pick<BackendVerdict, "answered">;

export interface SideResult {
  verdict: BackendVerdict;
  sources: AssembledSource[];
}

/** The side-by-side eval of one question from each store's grade and returned sources. */
export function sideBySide(
  asked: { path: string; question: string },
  lore: SideResult,
  utopia: SideResult,
): SideBySideEval {
  return {
    ...asked,
    lore: lore.verdict,
    utopia: utopia.verdict,
    top_k_overlap: sourceOverlap(lore.sources, utopia.sources),
    only_answered_by: onlyAnsweredBy(lore.verdict, utopia.verdict),
  };
}

/** Jaccard of two assemblies' source paths, to two decimals; two empty assemblies share nothing. */
export function sourceOverlap(
  left: AssembledSource[],
  right: AssembledSource[],
): number {
  const leftPaths = new Set(left.map((source) => source.path));
  const rightPaths = new Set(right.map((source) => source.path));
  const union = new Set([...leftPaths, ...rightPaths]);

  if (union.size === 0) {
    return 0;
  }
  const shared = [...leftPaths].filter((path) => rightPaths.has(path));

  return Math.round((shared.length / union.size) * 100) / 100;
}

/** The store whose assembly alone answered the question; null when both or neither did. */
export function onlyAnsweredBy(
  lore: Answered,
  utopia: Answered,
): SingleBackend | null {
  if (lore.answered === utopia.answered) {
    return null;
  }

  return lore.answered ? "lore" : "utopia";
}
