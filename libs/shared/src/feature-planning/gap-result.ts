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

function parseArchitecture(raw: unknown): GapArchitecture {
  const o = asObject(raw, "architecture");
  return {
    summary: asString(o.summary, "architecture.summary"),
    components: asArray(o.components, "architecture.components").map((c, i) => {
      const co = asObject(c, `architecture.components[${i}]`);
      return {
        name: asString(co.name, `architecture.components[${i}].name`),
        responsibility: asString(
          co.responsibility,
          `architecture.components[${i}].responsibility`,
        ),
        touchpoints: asStringArray(
          co.touchpoints,
          `architecture.components[${i}].touchpoints`,
        ),
      };
    }),
  };
}

function parseQuestion(raw: unknown, i: number): GapQuestion {
  const o = asObject(raw, `questions[${i}]`);
  const kind = asString(o.kind, `questions[${i}].kind`);
  if (kind !== "text" && kind !== "choice") {
    fail(`questions[${i}].kind`, "must be 'text' or 'choice'");
  }
  const question: GapQuestion = {
    id: asString(o.id, `questions[${i}].id`),
    question: asString(o.question, `questions[${i}].question`),
    why: asString(o.why, `questions[${i}].why`),
    kind: kind as GapQuestionKind,
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
    mockups: asArray(o.mockups, "mockups").map((m, i) => {
      const mo = asObject(m, `mockups[${i}]`);
      if (mo.format !== "svg") fail(`mockups[${i}].format`, "must be 'svg'");
      return {
        title: asString(mo.title, `mockups[${i}].title`),
        format: "svg" as const,
        markup: asString(mo.markup, `mockups[${i}].markup`),
      };
    }),
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
const HREF_RE = /\s+(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*')/gi;
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
    .replace(HREF_RE, (match, quoted: string) => {
      const value = quoted.slice(1, -1);
      return SAFE_HREF_RE.test(value) ? match : "";
    });
}

/**
 * A round needs the author back in the loop when it asks questions or proposes a
 * split; otherwise the accumulated draft is ready to finalize.
 */
export function decideFeatureStatus(gap: GapResult): FeaturePlanningStatus {
  if (gap.questions.length > 0 || gap.split_suggestion) return "awaiting-input";
  return "spec-ready";
}
