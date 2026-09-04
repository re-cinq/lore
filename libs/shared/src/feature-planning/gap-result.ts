/** Canonical contract for the structured gap-analysis a feature-planning Station POSTs per round: ordered adaptive `sections`, each with optional content/mockups/questions. Hand-rolled validation (no Zod) for the Job pod bundle. See ADR-027. */

import { deriveSectionsFromLegacy } from "./gap-result-legacy.js";

export type SectionDirection = "keep" | "refine" | "redirect";
export type FeaturePlanningStatus = "awaiting-input" | "spec-ready";
export type GapQuestionKind = "text" | "choice";

/** How a mockup's `markup` must be interpreted: SVG document, mermaid source, or HTML fragment — each renders differently. */
export type GapMockupFormat = "svg" | "mermaid" | "html";

export interface GapMockup {
  title: string;
  format: GapMockupFormat;
  markup: string;
  /** Pixel height an `html` mockup needs — its sandboxed frame cannot measure itself. */
  height?: number;
  /** Legacy: which section a top-level mockup illustrated; new results nest mockups under their section. */
  section?: string;
}

export interface GapQuestion {
  id: string;
  /** Short, one-line question — detail/rationale belongs in {@link why}. */
  question: string;
  why: string;
  kind: GapQuestionKind;
  options?: string[];
}

export interface GapProposedFeature {
  title: string;
  scope: string;
}

export interface GapSplitSuggestion {
  rationale: string;
  proposed_features: GapProposedFeature[];
}

/** One adaptive section of the analysis, naming only the fields it needs (content/mockups/questions). `sections[0]` is always "Overview". */
export interface GapSection {
  title: string;
  content?: string;
  mockups?: GapMockup[];
  questions?: GapQuestion[];
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

function fail(field: string, detail: string): never {
  throw new Error(`GapResult invalid: ${field} ${detail}`);
}

export function asObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(field, "must be an object");
  }

  return value as Record<string, unknown>;
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    fail(field, "must be a string");
  }

  return value as string;
}

export function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    fail(field, "must be an array");
  }

  return value.map((v, i) => asString(v, `${field}[${i}]`));
}

export function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(field, "must be an array");
  }

  return value;
}

/** First non-empty string among the candidates, else "". Tolerates LLM field drift. */
export function firstString(...values: unknown[]): string {
  const hit = values.find((v) => typeof v === "string" && v.length > 0);

  return typeof hit === "string" ? hit : "";
}

/** String entries of an array, or [] when absent/non-array. */
export function lenientStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((v): v is string => typeof v === "string");
}

const MOCKUP_FORMATS: ReadonlySet<string> = new Set(["svg", "mermaid", "html"]);

/** Resolve a declared format, or `null` when unrenderable; an unrecognized name falls back to svg only if the markup is visibly an SVG document (guessing wrong is worse than dropping). */
function mockupFormat(
  declared: string,
  markup: string,
): GapMockupFormat | null {
  if (MOCKUP_FORMATS.has(declared)) {
    return declared as GapMockupFormat;
  }

  return markup.trimStart().startsWith("<svg") ? "svg" : null;
}

function buildMockup(
  mo: Record<string, unknown>,
  i: number,
  format: GapMockupFormat,
  markup: string,
): GapMockup {
  const mockup: GapMockup = {
    title: firstString(mo.title, mo.name) || `Mockup ${i + 1}`,
    format,
    markup,
  };
  const section = firstString(mo.section);

  if (section) {
    mockup.section = section;
  }

  if (typeof mo.height === "number" && Number.isFinite(mo.height)) {
    mockup.height = mo.height;
  }

  return mockup;
}

/** A mockup as a `{title, format, markup}` object, tolerating a bare SVG string or a `svg`/`content` alias; `null` when the named format can't be rendered. */
export function parseMockup(raw: unknown, i: number): GapMockup | null {
  if (typeof raw === "string") {
    return { title: `Mockup ${i + 1}`, format: "svg", markup: raw };
  }
  const mo = asObject(raw, `mockups[${i}]`);
  const markup = firstString(mo.markup, mo.svg, mo.content);
  const format = mockupFormat(firstString(mo.format) || "svg", markup);

  return format ? buildMockup(mo, i, format, markup) : null;
}

function withFreeTextOptions(
  question: GapQuestion,
  o: Record<string, unknown>,
): GapQuestion {
  if (o.options !== undefined) {
    question.options = lenientStringArray(o.options);
  }

  return question;
}

function withChoiceOptions(
  question: GapQuestion,
  o: Record<string, unknown>,
  i: number,
): GapQuestion {
  const options = asStringArray(o.options, `questions[${i}].options`);

  if (options.length === 0) {
    fail(`questions[${i}].options`, "must be non-empty for a choice question");
  }
  question.options = options;

  return question;
}

// Tolerate field drift: `text`/`prompt`, missing id/why, garbled kind (defaults to free-text).
export function parseQuestion(raw: unknown, i: number): GapQuestion {
  const o = asObject(raw, `questions[${i}]`);
  const kind: GapQuestionKind = o.kind === "choice" ? "choice" : "text";
  const question: GapQuestion = {
    id: firstString(o.id) || `q${i + 1}`,
    question: firstString(o.question, o.text, o.prompt),
    why: firstString(o.why, o.rationale, o.detail),
    kind,
  };

  return kind === "choice"
    ? withChoiceOptions(question, o, i)
    : withFreeTextOptions(question, o);
}

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
