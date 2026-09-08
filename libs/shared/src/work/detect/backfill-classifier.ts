// LLM classifier (batched fallback) for spec-coverage-backfill, inlined from the v2 linker: labels statements the heuristic couldn't as testable/untestable.
import {
  buildIntroOrdinals,
  classifyByHeuristic,
  type Statement,
  type Classification,
  type UntestableCategory,
} from "../../domain/spec-segment.js";
import { Llm } from "../../outbound/llm/llm.js";

const CLASSIFIER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ordinal: { type: "integer" },
          testability: { type: "string", enum: ["testable", "untestable"] },
          category: {
            type: "string",
            enum: [
              "intro",
              "vision",
              "background",
              "clarification",
              "open-question",
              "limitation",
              "rationale",
            ],
            description: "Only required when testability=untestable",
          },
        },
        required: ["ordinal", "testability"],
      },
    },
  },
  required: ["classifications"],
};

const CLASSIFIER_BATCH_LIMIT = 60;

interface LLMClassification {
  ordinal: number;
  testability: "testable" | "untestable";
  category?: UntestableCategory;
}

interface ResolvedClassification {
  testability: "testable" | "untestable";
  category: UntestableCategory | null;
}

function classificationFromLLM(
  c: LLMClassification,
): [number, ResolvedClassification] | null {
  if (typeof c.ordinal !== "number") {
    return null;
  }

  const untestable = c.testability === "untestable";

  return [
    c.ordinal,
    {
      testability: untestable ? "untestable" : "testable",
      category: untestable ? (c.category ?? null) : null,
    },
  ];
}

/** The classification prompt. Statements are enumerated by ORDINAL so the answer can be matched back without relying on the model echoing the text, and each carries its enclosing heading — "the response is empty" means something different under Errors than under Background. The bias toward "testable" is deliberate: a false "untestable" hides a real coverage gap, while a false "testable" only produces a suggestion a human declines. */
function classifierPrompt(specPath: string, batch: Statement[]): string {
  const formatted = batch
    .map(
      (s) =>
        `[${s.ordinal}] (under "${s.enclosingHeading ?? "<intro>"}") ${s.text}`,
    )
    .join("\n");

  return `Classify each enumerated statement as either a NORMATIVE TESTABLE REQUIREMENT (something that could be validated by an automated test) or NARRATIVE (intro / vision / background / clarification / open-question / limitation / rationale).

Bias toward "testable" — if you're unsure, return "testable". A false "untestable" hides a real coverage gap.

For "untestable", pick the closest category from: intro, vision, background, clarification, open-question, limitation, rationale.

SPEC: ${specPath}

STATEMENTS:
${formatted}`;
}

/** Asks the model, through a TOOL rather than free text: the schema is what makes an answer parseable per ordinal instead of prose somebody has to interpret. */
async function askClassifier(
  specPath: string,
  batch: Statement[],
): Promise<LLMClassification[]> {
  const llm = await Llm.instance.completeWithTool<{
    classifications?: LLMClassification[];
  }>({
    prompt: classifierPrompt(specPath, batch),
    systemPrompt:
      "You classify spec statements as testable requirements or narrative prose. Bias toward testable when unsure.",
    toolName: "classify_statements",
    toolDescription: "Classify each statement as testable or untestable",
    toolSchema: CLASSIFIER_TOOL_SCHEMA,
    jobName: "spec_coverage_backfill",
  });

  return llm.parsed.classifications || [];
}

/** The model's answers keyed by ordinal; an answer the parser cannot key is dropped rather than guessed at. */
function classificationMap(
  answers: LLMClassification[],
): Map<number, ResolvedClassification> {
  const result = new Map<number, ResolvedClassification>();

  for (const c of answers) {
    const entry = classificationFromLLM(c);

    if (entry) {
      result.set(entry[0], entry[1]);
    }
  }

  return result;
}

function warnClassifierFailed(specPath: string, err: unknown): void {
  console.warn(
    `[job] spec-coverage-backfill: LLM classifier failed for ${specPath}; defaulting to testable —`,
    err,
  );
}

async function classifyLLM(
  specPath: string,
  unclassified: Statement[],
): Promise<Map<number, ResolvedClassification>> {
  if (unclassified.length === 0) {
    return new Map();
  }

  const batch = unclassified.slice(0, CLASSIFIER_BATCH_LIMIT);

  try {
    return classificationMap(await askClassifier(specPath, batch));
  } catch (err) {
    warnClassifierFailed(specPath, err);

    return new Map();
  }
}

/** A statement the model did not classify defaults to TESTABLE, and so does one it failed to answer for at all — the same bias the prompt asks for. `matchedBySection` is false because the heuristic did not decide this one; only a section match sets it. */
function resolveClassification(
  decision: ResolvedClassification | undefined,
): Classification {
  return decision && decision.testability === "untestable"
    ? {
        testability: "untestable",
        category: decision.category,
        matchedBySection: false,
      }
    : { testability: "testable", category: null, matchedBySection: false };
}

/** The free pass: statements a SECTION match already settles, and the remainder the model has to look at. */
function splitByHeuristic(statements: Statement[]): {
  classified: Map<number, Classification>;
  unclassified: Statement[];
} {
  const introOrdinals = buildIntroOrdinals(statements);
  const classified = new Map<number, Classification>();
  const unclassified: Statement[] = [];

  for (const s of statements) {
    const c = classifyByHeuristic(s, introOrdinals);

    if (c.matchedBySection) {
      classified.set(s.ordinal, c);
      continue;
    }
    unclassified.push(s);
  }

  return { classified, unclassified };
}

export async function classifyAllStatements(
  specPath: string,
  statements: Statement[],
): Promise<Map<number, Classification>> {
  const { classified, unclassified } = splitByHeuristic(statements);
  const llm = await classifyLLM(specPath, unclassified);

  for (const s of unclassified) {
    classified.set(s.ordinal, resolveClassification(llm.get(s.ordinal)));
  }

  return classified;
}
