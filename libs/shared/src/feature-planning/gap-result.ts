/**
 * Canonical contract for the structured gap-analysis a feature-planning Station
 * produces and POSTs back per round. Shared between the mcp-server result
 * endpoint (validates + persists), the web-ui renderer (mirrors these types),
 * and the planning prompt. Hand-rolled validation (no Zod dep) keeps this module
 * light enough to ride along in the Job pod bundle, matching the rest of
 * libs/shared. See specs/7-feature-planning/ and ADR-027.
 */

export type SectionDirection = "keep" | "refine" | "redirect";
export type FeaturePlanningStatus = "awaiting-input" | "spec-ready";

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

export interface GapMockup {
  title: string;
  format: "svg";
  markup: string;
}

export type GapQuestionKind = "text" | "choice";

export interface GapQuestion {
  id: string;
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

export interface GapResult {
  architecture: GapArchitecture;
  user_flows: GapUserFlow[];
  mockups: GapMockup[];
  questions: GapQuestion[];
  split_suggestion?: GapSplitSuggestion;
  draft_spec_markdown: string;
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

/** First string among the candidates, else "". Tolerates LLM field drift
 *  (models emit `description`/`summary` where the schema wants `responsibility`). */
function firstString(...values: unknown[]): string {
  const hit = values.find((v) => typeof v === "string" && v.length > 0);
  return typeof hit === "string" ? hit : "";
}

/** String entries of an array, or [] when absent/non-array. */
function lenientStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function parseArchitecture(raw: unknown): GapArchitecture {
  const o = asObject(raw, "architecture");
  return {
    summary: firstString(o.summary, o.description),
    components: asArray(o.components, "architecture.components").map((c, i) => {
      const co = asObject(c, `architecture.components[${i}]`);
      return {
        name: asString(co.name, `architecture.components[${i}].name`),
        responsibility: firstString(co.responsibility, co.description, co.summary),
        touchpoints: lenientStringArray(co.touchpoints),
      };
    }),
  };
}

/** A mockup as a `{title, format:"svg", markup}` object — tolerating a bare SVG
 *  string (models often emit the markup directly) or a `svg`/`content` alias. */
function parseMockup(raw: unknown, i: number): GapMockup {
  if (typeof raw === "string") {
    return { title: `Mockup ${i + 1}`, format: "svg", markup: raw };
  }
  const mo = asObject(raw, `mockups[${i}]`);
  return {
    title: firstString(mo.title, mo.name) || `Mockup ${i + 1}`,
    format: "svg",
    markup: firstString(mo.markup, mo.svg, mo.content),
  };
}

function parseQuestion(raw: unknown, i: number): GapQuestion {
  const o = asObject(raw, `questions[${i}]`);
  // Tolerate field drift: `text`/`prompt` for the question, missing id/why, and a
  // missing/garbled kind (default to free-text). A choice still needs options.
  const kind: GapQuestionKind = o.kind === "choice" ? "choice" : "text";
  const question: GapQuestion = {
    id: firstString(o.id) || `q${i + 1}`,
    question: firstString(o.question, o.text, o.prompt),
    why: firstString(o.why, o.rationale),
    kind,
  };
  if (kind === "choice") {
    const options = asStringArray(o.options, `questions[${i}].options`);
    if (options.length === 0) fail(`questions[${i}].options`, "must be non-empty for a choice question");
    question.options = options;
  } else if (o.options !== undefined) {
    question.options = asStringArray(o.options, `questions[${i}].options`);
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
        title: asString(po.title, `split_suggestion.proposed_features[${i}].title`),
        scope: asString(po.scope, `split_suggestion.proposed_features[${i}].scope`),
      };
    }),
  };
}

/**
 * Validate an untrusted (LLM-produced) gap-analysis payload into a typed
 * {@link GapResult}, throwing on any structural violation. Does NOT sanitize
 * mockup markup — callers run {@link sanitizeSvg} over each mockup before
 * persisting/rendering.
 */
export function parseGapResult(raw: unknown): GapResult {
  const o = asObject(raw, "root");
  const result: GapResult = {
    architecture: parseArchitecture(o.architecture),
    user_flows: asArray(o.user_flows, "user_flows").map((f, i) => {
      const fo = asObject(f, `user_flows[${i}]`);
      return {
        name: asString(fo.name, `user_flows[${i}].name`),
        steps: asStringArray(fo.steps, `user_flows[${i}].steps`),
      };
    }),
    mockups: asArray(o.mockups, "mockups").map(parseMockup),
    questions: asArray(o.questions, "questions").map(parseQuestion),
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
 * Defense-in-depth sanitizer for LLM-generated mockup SVG. The primary control
 * is rendering inside a sandboxed iframe, but we also strip the obvious vectors
 * before persistence: <script>/<foreignObject> elements, inline event handlers,
 * and href/xlink:href values that are not fragment (#…) or data:image/ refs.
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

const PLANNING_PHASE_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "planning",
  "awaiting-input",
  "spec-ready",
]);

/**
 * Whether a feature is still mid-planning. A round's GapResult may only advance
 * the feature from one of these statuses — a stale/duplicate pod POST must not
 * drag an already-finalized feature (pr-open/implemented/split) back into the
 * wizard.
 */
export function isPlanningPhase(status: string): boolean {
  return PLANNING_PHASE_STATUSES.has(status);
}

/**
 * A round needs the author back in the loop when it asks questions or proposes a
 * split; otherwise the accumulated draft is ready to finalize.
 */
export function decideFeatureStatus(gap: GapResult): FeaturePlanningStatus {
  if (gap.questions.length > 0 || gap.split_suggestion) return "awaiting-input";
  return "spec-ready";
}
