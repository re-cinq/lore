// LLM classifier (batched fallback) for spec-coverage-backfill, inlined from the v2 linker: labels statements the heuristic couldn't as testable/untestable.
import {
  buildIntroOrdinals,
  classifyByHeuristic,
  Llm,
  type Statement,
  type Classification,
  type UntestableCategory,
} from "../index.js";

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

async function classifyLLM(
  specPath: string,
  unclassified: Statement[],
): Promise<Map<number, ResolvedClassification>> {
  const result = new Map<number, ResolvedClassification>();

  if (unclassified.length === 0) {
    return result;
  }

  const batch = unclassified.slice(0, CLASSIFIER_BATCH_LIMIT);
  const formatted = batch
    .map(
      (s) =>
        `[${s.ordinal}] (under "${s.enclosingHeading ?? "<intro>"}") ${s.text}`,
    )
    .join("\n");

  try {
    const llm = await Llm.instance.completeWithTool<{
      classifications?: LLMClassification[];
    }>({
      prompt: `Classify each enumerated statement as either a NORMATIVE TESTABLE REQUIREMENT (something that could be validated by an automated test) or NARRATIVE (intro / vision / background / clarification / open-question / limitation / rationale).

Bias toward "testable" — if you're unsure, return "testable". A false "untestable" hides a real coverage gap.

For "untestable", pick the closest category from: intro, vision, background, clarification, open-question, limitation, rationale.

SPEC: ${specPath}

STATEMENTS:
${formatted}`,
      systemPrompt:
        "You classify spec statements as testable requirements or narrative prose. Bias toward testable when unsure.",
      toolName: "classify_statements",
      toolDescription: "Classify each statement as testable or untestable",
      toolSchema: CLASSIFIER_TOOL_SCHEMA,
      jobName: "spec_coverage_backfill",
    });

    for (const c of llm.parsed.classifications || []) {
      const entry = classificationFromLLM(c);

      if (!entry) {
        continue;
      }
      result.set(entry[0], entry[1]);
    }
  } catch (err) {
    console.warn(
      `[job] spec-coverage-backfill: LLM classifier failed for ${specPath}; defaulting to testable —`,
      err,
    );
  }

  return result;
}

export async function classifyAllStatements(
  specPath: string,
  statements: Statement[],
): Promise<Map<number, Classification>> {
  const introOrdinals = buildIntroOrdinals(statements);
  const out = new Map<number, Classification>();
  const unclassified: Statement[] = [];

  for (const s of statements) {
    const c = classifyByHeuristic(s, introOrdinals);

    if (c.matchedBySection) {
      out.set(s.ordinal, c);
      continue;
    }
    unclassified.push(s);
  }
  const llm = await classifyLLM(specPath, unclassified);

  for (const s of unclassified) {
    const decision = llm.get(s.ordinal);

    const classification: Classification =
      decision && decision.testability === "untestable"
        ? {
            testability: "untestable",
            category: decision.category,
            matchedBySection: false,
          }
        : {
            testability: "testable",
            category: null,
            matchedBySection: false,
          };

    out.set(s.ordinal, classification);
  }

  return out;
}
