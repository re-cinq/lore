/** Hand-rolled validation primitives (asObject/asString/...) plus the mockup/question shapes and parsers, shared by gap-result.ts (the current `sections[]` contract) and gap-result-legacy.ts (normalizing pre-dynamic-sections payloads), so neither imports the other. */

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

/** One adaptive section of the analysis, naming only the fields it needs (content/mockups/questions). `sections[0]` is always "Overview". */
export interface GapSection {
  title: string;
  content?: string;
  mockups?: GapMockup[];
  questions?: GapQuestion[];
}

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
