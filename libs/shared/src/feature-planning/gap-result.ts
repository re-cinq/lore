/**
 * Canonical contract for the structured gap-analysis a feature-planning Station
 * produces and POSTs back per round. The result is an ORDERED list of adaptive
 * `sections` the agent chooses per feature (the first is always an "Overview");
 * each section carries optional prose `content`, `mockups` (diagrams), and its own
 * follow-up `questions` (rendered right after it). Shared between the mcp-server
 * result endpoint (validates + persists), the web-ui renderer (mirrors these
 * types), and the planning prompt. Hand-rolled validation (no Zod) keeps this
 * light enough to ride along in the Job pod bundle. See ADR-027.
 */

export type SectionDirection = "keep" | "refine" | "redirect";
export type FeaturePlanningStatus = "awaiting-input" | "spec-ready";
export type GapQuestionKind = "text" | "choice";

export interface GapMockup {
  title: string;
  format: "svg";
  markup: string;
  /** Legacy: which section a top-level mockup illustrated. New results nest
   *  mockups under their section instead. */
  section?: string;
}

export interface GapQuestion {
  id: string;
  /** Short, one-line question — all detail/rationale belongs in {@link why}. */
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

/**
 * One adaptive section of the analysis. The agent names it and includes only the
 * fields it needs: prose `content` (markdown), `mockups` (SVG diagrams), and the
 * `questions` that belong to this section. `sections[0]` is always an "Overview".
 */
export interface GapSection {
  title: string;
  content?: string;
  mockups?: GapMockup[];
  questions?: GapQuestion[];
}

export interface GapResult {
  sections: GapSection[];
  split_suggestion?: GapSplitSuggestion;
  draft_spec_markdown: string;
}

// Legacy (pre-dynamic-sections) shapes, retained only so old stored results and
// model drift can be normalized into `sections`.
export interface ArchitectureComponent {
  name: string;
  responsibility: string;
  touchpoints: string[];
}
export interface GapArchitecture {
  summary: string;
  components: ArchitectureComponent[];
}
export interface GapUserFlow {
  name: string;
  steps: string[];
}

function fail(field: string, detail: string): never {
  throw new Error(`GapResult invalid: ${field} ${detail}`);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(field, "must be a string");
  return value as string;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail(field, "must be an array");
  return value.map((v, i) => asString(v, `${field}[${i}]`));
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(field, "must be an array");
  return value;
}

/** First non-empty string among the candidates, else "". Tolerates LLM field drift. */
function firstString(...values: unknown[]): string {
  const hit = values.find((v) => typeof v === "string" && v.length > 0);
  return typeof hit === "string" ? hit : "";
}

/** String entries of an array, or [] when absent/non-array. */
function lenientStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** A mockup as a `{title, format:"svg", markup}` object — tolerating a bare SVG
 *  string (models often emit the markup directly) or a `svg`/`content` alias. */
function parseMockup(raw: unknown, i: number): GapMockup {
  if (typeof raw === "string") {
    return { title: `Mockup ${i + 1}`, format: "svg", markup: raw };
  }
  const mo = asObject(raw, `mockups[${i}]`);
  const mockup: GapMockup = {
    title: firstString(mo.title, mo.name) || `Mockup ${i + 1}`,
    format: "svg",
    markup: firstString(mo.markup, mo.svg, mo.content),
  };
  const section = firstString(mo.section);
  if (section) mockup.section = section;
  return mockup;
}

function parseQuestion(raw: unknown, i: number): GapQuestion {
  const o = asObject(raw, `questions[${i}]`);
  // Tolerate field drift: `text`/`prompt` for the question, missing id/why, and a
  // missing/garbled kind (default to free-text). A choice still needs options.
  const kind: GapQuestionKind = o.kind === "choice" ? "choice" : "text";
  const question: GapQuestion = {
    id: firstString(o.id) || `q${i + 1}`,
    question: firstString(o.question, o.text, o.prompt),
    why: firstString(o.why, o.rationale, o.detail),
    kind,
  };
  if (kind === "choice") {
    const options = asStringArray(o.options, `questions[${i}].options`);
    if (options.length === 0)
      fail(
        `questions[${i}].options`,
        "must be non-empty for a choice question",
      );
    question.options = options;
  } else if (o.options !== undefined) {
    question.options = lenientStringArray(o.options);
  }
  return question;
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

/** Parse one adaptive section — title + optional content/mockups/questions. */
function parseSection(raw: unknown, i: number): GapSection {
  const o = asObject(raw, `sections[${i}]`);
  const section: GapSection = {
    title: firstString(o.title, o.name) || `Section ${i + 1}`,
  };
  const content = firstString(o.content, o.body, o.markdown, o.summary);
  if (content) section.content = content;
  if (o.mockups !== undefined && o.mockups !== null) {
    const mockups = asArray(o.mockups, `sections[${i}].mockups`).map(
      parseMockup,
    );
    if (mockups.length) section.mockups = mockups;
  }
  if (o.questions !== undefined && o.questions !== null) {
    const questions = asArray(o.questions, `sections[${i}].questions`).map(
      parseQuestion,
    );
    if (questions.length) section.questions = questions;
  }
  return section;
}

function parseArchitecture(raw: unknown): GapArchitecture {
  const o = asObject(raw, "architecture");
  return {
    summary: firstString(o.summary, o.description),
    components: asArray(o.components, "architecture.components").map((c, i) => {
      const co = asObject(c, `architecture.components[${i}]`);
      return {
        name: asString(co.name, `architecture.components[${i}].name`),
        responsibility: firstString(
          co.responsibility,
          co.description,
          co.summary,
        ),
        touchpoints: lenientStringArray(co.touchpoints),
      };
    }),
  };
}

/** Build `sections` from a legacy architecture/user_flows/mockups/questions payload. */
function deriveSectionsFromLegacy(o: Record<string, unknown>): GapSection[] {
  const sections: GapSection[] = [];
  const mockups = Array.isArray(o.mockups) ? o.mockups.map(parseMockup) : [];
  const mockupsTagged = (key: string): GapMockup[] | undefined => {
    const m = mockups.filter((mk) => (mk.section ?? "architecture") === key);
    return m.length ? m : undefined;
  };

  if (o.architecture !== undefined && o.architecture !== null) {
    const arch = parseArchitecture(o.architecture);
    const lines = [arch.summary];
    if (arch.components.length) {
      lines.push(
        "",
        ...arch.components.map(
          (c) =>
            `- **${c.name}**: ${c.responsibility}${c.touchpoints.length ? ` _(${c.touchpoints.join(", ")})_` : ""}`,
        ),
      );
    }
    const m = mockupsTagged("architecture");
    sections.push({
      title: "Architecture",
      content: lines.join("\n"),
      ...(m ? { mockups: m } : {}),
    });
  }

  if (Array.isArray(o.user_flows) && o.user_flows.length) {
    const content = o.user_flows
      .map((f, i) => {
        const fo = asObject(f, `user_flows[${i}]`);
        const name = asString(fo.name, `user_flows[${i}].name`);
        const steps = asStringArray(fo.steps, `user_flows[${i}].steps`);
        return [`**${name}**`, ...steps.map((s, j) => `${j + 1}. ${s}`)].join(
          "\n",
        );
      })
      .join("\n\n");
    const m = mockupsTagged("user_flows");
    sections.push({
      title: "User flows",
      content,
      ...(m ? { mockups: m } : {}),
    });
  }

  const orphanMockups = mockups.filter(
    (mk) =>
      !["architecture", "user_flows"].includes(mk.section ?? "architecture"),
  );
  if (orphanMockups.length)
    sections.push({ title: "Diagrams", mockups: orphanMockups });

  if (Array.isArray(o.questions) && o.questions.length) {
    sections.push({
      title: "Open questions",
      questions: o.questions.map(parseQuestion),
    });
  }

  return sections;
}

/**
 * Validate an untrusted (LLM-produced) gap-analysis payload into a typed
 * {@link GapResult}, throwing on any structural violation. Accepts both the new
 * `sections[]` shape and a legacy `architecture`/`user_flows`/… payload (normalized
 * into sections). Does NOT sanitize mockup markup — callers run {@link sanitizeSvg}
 * over each mockup before persisting/rendering.
 */
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
  return result;
}

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const FOREIGN_OBJECT_RE = /<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi;
const EVENT_HANDLER_RE = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const HREF_RE = /\s+(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const SAFE_HREF_RE = /^(#|data:image\/)/i;

/**
 * Defense-in-depth sanitizer for LLM-generated mockup SVG. Strips the obvious
 * vectors before persistence: <script>/<foreignObject> elements, inline event
 * handlers, and href/xlink:href values that are not fragment (#…) or data:image/ refs.
 */
export function sanitizeSvg(markup: string): string {
  return markup
    .replace(SCRIPT_RE, "")
    .replace(FOREIGN_OBJECT_RE, "")
    .replace(EVENT_HANDLER_RE, "")
    .replace(HREF_RE, (match, value: string) => {
      const unquoted = value.replace(/^["']|["']$/g, "");
      return SAFE_HREF_RE.test(unquoted) ? match : "";
    });
}

/** Sanitize every mockup's markup across all sections, in place-safe (returns a copy). */
export function sanitizeGapResult(gap: GapResult): GapResult {
  return {
    ...gap,
    sections: gap.sections.map((s) =>
      s.mockups
        ? {
            ...s,
            mockups: s.mockups.map((m) => ({
              ...m,
              markup: sanitizeSvg(m.markup),
            })),
          }
        : s,
    ),
  };
}

const PLANNING_PHASE_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "planning",
  "awaiting-input",
  "spec-ready",
]);

/**
 * Whether a feature is still mid-planning. A round's GapResult may only advance the
 * feature from one of these statuses — a stale/duplicate pod POST must not drag an
 * already-finalized feature (pr-open/implemented/split) back into the wizard.
 */
export function isPlanningPhase(status: string): boolean {
  return PLANNING_PHASE_STATUSES.has(status);
}

/**
 * A uniform sections list from a gap that may be the new shape OR a raw, stored
 * legacy payload (architecture/user_flows/…). Never throws — [] on garbage.
 */
export function sectionsOf(
  gap: GapResult | Record<string, unknown> | null | undefined,
): GapSection[] {
  if (!gap) return [];
  const g = gap as Record<string, unknown>;
  if (Array.isArray(g.sections)) return g.sections as GapSection[];
  try {
    return deriveSectionsFromLegacy(g);
  } catch {
    return [];
  }
}

/**
 * A round needs the author back in the loop when any section asks questions or it
 * proposes a split; otherwise the accumulated draft is ready to finalize.
 */
export function decideFeatureStatus(gap: GapResult): FeaturePlanningStatus {
  const hasQuestions = gap.sections.some((s) => (s.questions?.length ?? 0) > 0);
  if (hasQuestions || gap.split_suggestion) return "awaiting-input";
  return "spec-ready";
}
