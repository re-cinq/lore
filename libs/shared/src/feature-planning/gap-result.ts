/** Canonical contract for the structured gap-analysis a feature-planning Station POSTs per round: ordered adaptive `sections`, each with optional content/mockups/questions. Hand-rolled validation (no Zod) for the Job pod bundle. See ADR-027. */

import { deriveSectionsFromLegacy } from "./gap-result-legacy.js";
import {
  asObject,
  asString,
  asArray,
  firstString,
  parseMockup,
  parseQuestion,
  type GapMockup,
  type GapQuestion,
  type GapSection,
} from "./gap-result-primitives.js";

// Validation primitives + mockup/question shapes live in gap-result-primitives.ts, re-exported for import-path back-compat.
export {
  asObject,
  asString,
  asStringArray,
  asArray,
  firstString,
  lenientStringArray,
  parseMockup,
  parseQuestion,
  type GapQuestionKind,
  type GapMockupFormat,
  type GapMockup,
  type GapQuestion,
  type GapSection,
} from "./gap-result-primitives.js";

export type SectionDirection = "keep" | "refine" | "redirect";
export type FeaturePlanningStatus = "awaiting-input" | "spec-ready";

export interface GapProposedFeature {
  title: string;
  scope: string;
}

export interface GapSplitSuggestion {
  rationale: string;
  proposed_features: GapProposedFeature[];
}

// The feature-planning Station's own wire contract (ADR-027), not a table row.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface GapResult {
  sections: GapSection[];
  /** CSS lifted from the planned repository so a mockup wears that project's colours, not the dashboard's. */
  mockup_stylesheet?: string;
  split_suggestion?: GapSplitSuggestion;
  draft_spec_markdown: string;
}

// Legacy (pre-dynamic-sections) shapes + normalization live in gap-result-legacy.ts, re-exported for import-path back-compat.
export {
  deriveSectionsFromLegacy,
  type ArchitectureComponent,
  type GapArchitecture,
  type GapUserFlow,
} from "./gap-result-legacy.js";

function parseSplit(raw: unknown): GapSplitSuggestion {
  const o = asObject(raw, "split_suggestion");

  return {
    rationale: asString(o.rationale, "split_suggestion.rationale"),
    proposed_features: asArray(
      o.proposed_features,
      "split_suggestion.proposed_features",
    ).map((p, i) => {
      const po = asObject(p, `split_suggestion.proposed_features[${i}]`);

      return {
        title: asString(
          po.title,
          `split_suggestion.proposed_features[${i}].title`,
        ),
        scope: asString(
          po.scope,
          `split_suggestion.proposed_features[${i}].scope`,
        ),
      };
    }),
  };
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function parseSectionMockups(
  o: Record<string, unknown>,
  i: number,
): GapMockup[] {
  if (!isPresent(o.mockups)) {
    return [];
  }

  return asArray(o.mockups, `sections[${i}].mockups`)
    .map(parseMockup)
    .filter((m): m is GapMockup => m !== null);
}

function parseSectionQuestions(
  o: Record<string, unknown>,
  i: number,
): GapQuestion[] {
  if (!isPresent(o.questions)) {
    return [];
  }

  return asArray(o.questions, `sections[${i}].questions`).map(parseQuestion);
}

/** Parse one adaptive section — title + optional content/mockups/questions. */
function parseSection(raw: unknown, i: number): GapSection {
  const o = asObject(raw, `sections[${i}]`);
  const section: GapSection = {
    title: firstString(o.title, o.name) || `Section ${i + 1}`,
  };
  const content = firstString(o.content, o.body, o.markdown, o.summary);

  if (content) {
    section.content = content;
  }
  const mockups = parseSectionMockups(o, i);

  if (mockups.length) {
    section.mockups = mockups;
  }
  const questions = parseSectionQuestions(o, i);

  if (questions.length) {
    section.questions = questions;
  }

  return section;
}

/** Validates an untrusted LLM-produced payload into a typed {@link GapResult} (new `sections[]` or legacy shape), throwing on violation. Does NOT sanitize markup — callers run {@link sanitizeSvg} first. */
export function parseGapResult(raw: unknown): GapResult {
  const o = asObject(raw, "root");
  const sections =
    o.sections !== undefined && o.sections !== null
      ? asArray(o.sections, "sections").map(parseSection)
      : deriveSectionsFromLegacy(o);
  const result: GapResult = {
    sections,
    draft_spec_markdown: asString(o.draft_spec_markdown, "draft_spec_markdown"),
  };

  if (o.split_suggestion !== undefined && o.split_suggestion !== null) {
    result.split_suggestion = parseSplit(o.split_suggestion);
  }
  const stylesheet = firstString(o.mockup_stylesheet);

  if (stylesheet) {
    result.mockup_stylesheet = stylesheet;
  }

  return result;
}

// Sanitizers for untrusted mockup markup/CSS live in gap-result-sanitize.ts, re-exported for import-path back-compat.
export {
  sanitizeSvg,
  sanitizeMockupCss,
  sanitizeGapResult,
} from "./gap-result-sanitize.js";

const PLANNING_PHASE_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "planning",
  "awaiting-input",
  "spec-ready",
]);

/** Whether a feature is still mid-planning — a GapResult may only advance from one of these statuses, so a stale POST can't drag a finalized feature back into the wizard. */
export function isPlanningPhase(status: string): boolean {
  return PLANNING_PHASE_STATUSES.has(status);
}

/** A uniform sections list from a gap that may be the new shape or a raw legacy payload. Never throws — [] on garbage. */
export function sectionsOf(
  gap: GapResult | Record<string, unknown> | null | undefined,
): GapSection[] {
  if (!gap) {
    return [];
  }
  const g = gap as Record<string, unknown>;

  if (Array.isArray(g.sections)) {
    return g.sections as GapSection[];
  }

  try {
    return deriveSectionsFromLegacy(g);
  } catch {
    return [];
  }
}

/** A round needs the author back when any section asks questions or proposes a split; otherwise the draft is ready to finalize. */
export function decideFeatureStatus(gap: GapResult): FeaturePlanningStatus {
  const hasQuestions = gap.sections.some((s) => (s.questions?.length ?? 0) > 0);

  if (hasQuestions || gap.split_suggestion) {
    return "awaiting-input";
  }

  return "spec-ready";
}
