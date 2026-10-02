import { describe, it, expect } from "vitest";
import { FakeLlm } from "@re-cinq/lore-shared/llm/fake-llm.js";
import {
  evaluateDocument,
  type AssembledForEval,
  type EvalDeps,
} from "./evaluate-document.js";

const ADR = "adrs/ADR-032-split-local-remote-api.md";
const QUESTION = "Can the MCP server query Postgres directly?";

const ASSEMBLED: AssembledForEval = {
  text: "<context>the adapter holds no database pool</context>",
  sources: [
    { path: ADR, tokens: 400 },
    { path: "docs/mcp-tools-reference.md", tokens: 200 },
    { path: "eslint.config.mjs", tokens: 400 },
  ],
};

const VERDICT = {
  answer: "No. The adapter holds no pool.",
  used_sources: [ADR, "docs/mcp-tools-reference.md"],
  addresses_question: true,
  contradicted_sentence: "",
  reason: "Agrees with the decision.",
};

interface Scenario {
  document?: string | null;
  assembled?: AssembledForEval;
  verdict?: Partial<typeof VERDICT>;
}

function scenario(given: Scenario = {}) {
  const llm = new FakeLlm({
    text: ` ${QUESTION}\n`,
    data: { ...VERDICT, ...given.verdict },
    usage: { model: "gemini-2.5-flash" },
  });
  const asked: Array<{ repo: string; question: string }> = [];
  const deps: EvalDeps = {
    llm,
    document: async () =>
      given.document === undefined
        ? "The adapter holds no pool."
        : given.document,
    assemble: async (repo, question) => {
      asked.push({ repo, question });

      return given.assembled ?? ASSEMBLED;
    },
  };

  return { llm, asked, deps };
}

const target = { repo: "re-cinq/lore", path: ADR };

describe("evaluateDocument", () => {
  it("reports ADR-032 found, answered and a useful share of 0.6 when 600 of 1000 returned tokens come from the sources the answer used", async () => {
    const { deps } = scenario();

    expect(await evaluateDocument(deps, target)).toEqual({
      path: ADR,
      question: QUESTION,
      found: true,
      answered: true,
      useful_share: 0.6,
      reason: "Agrees with the decision.",
      model: "gemini-2.5-flash",
    });
  });

  it("asks Lore the question the model wrote, for the document's repository", async () => {
    const { deps, asked } = scenario();

    await evaluateDocument(deps, target);

    expect(asked).toEqual([{ repo: "re-cinq/lore", question: QUESTION }]);
  });

  it("reports found false when ADR-032 is not among the returned sources", async () => {
    const { deps } = scenario({
      assembled: {
        text: "<context>lint rules</context>",
        sources: [{ path: "eslint.config.mjs", tokens: 400 }],
      },
      verdict: {
        used_sources: [],
        addresses_question: false,
        reason: "No basis.",
      },
    });

    expect(await evaluateDocument(deps, target)).toMatchObject({
      found: false,
      answered: false,
      useful_share: 0,
      reason: "No basis.",
    });
  });

  it("reports answered false when the judge quotes a sentence of the document the answer contradicts", async () => {
    const { deps } = scenario({
      verdict: {
        contradicted_sentence: "The adapter holds no pool.",
        reason: "The ADR rules a direct pool out.",
      },
    });

    expect(await evaluateDocument(deps, target)).toMatchObject({
      found: true,
      answered: false,
      reason: "The ADR rules a direct pool out.",
    });
  });

  it("reports answered true when the judge quotes a sentence but says it and the answer can both hold", async () => {
    const { deps } = scenario({
      verdict: {
        contradicted_sentence: "The adapter holds no pool.",
        both_can_hold: true,
        reason: "One describes the default, the other the startup check.",
      },
    });

    expect(await evaluateDocument(deps, target)).toMatchObject({
      answered: true,
    });
  });

  it("asks the model for all three calls at temperature 0, so a rerun of the same question differs as little as the model allows", async () => {
    const { deps, llm } = scenario();

    await evaluateDocument(deps, target);

    expect(llm.calls.map((call) => call.temperature)).toEqual([0, 0, 0]);
  });

  it("reports answered true when the sentence the judge calls contradicted is not in the document", async () => {
    const { deps } = scenario({
      verdict: {
        contradicted_sentence: "The document does not mention Tailwind.",
        reason: "The answer adds detail the document lacks.",
      },
    });

    expect(await evaluateDocument(deps, target)).toMatchObject({
      answered: true,
    });
  });

  it("finds the quoted sentence in the document whatever its line breaks and spacing", async () => {
    const { deps } = scenario({
      document: "The adapter\nholds   no pool.",
      verdict: { contradicted_sentence: "the adapter holds no pool." },
    });

    expect(await evaluateDocument(deps, target)).toMatchObject({
      answered: false,
    });
  });

  it("reports answered false when the judge says the answer does not address the question", async () => {
    const { deps } = scenario({
      verdict: {
        addresses_question: false,
        reason: "It says the context does not cover this.",
      },
    });

    expect(await evaluateDocument(deps, target)).toMatchObject({
      answered: false,
      reason: "It says the context does not cover this.",
    });
  });

  it("asks Lore the question the caller pinned and writes none, so a rerun grades the same question", async () => {
    const { deps, asked, llm } = scenario();
    const pinned = "Does the MCP adapter hold a database pool?";

    const verdict = await evaluateDocument(deps, {
      ...target,
      question: pinned,
    });

    expect(asked).toEqual([{ repo: "re-cinq/lore", question: pinned }]);
    expect(verdict?.question).toBe(pinned);
    expect(llm.calls).toHaveLength(2);
  });

  it("counts only sources Lore returned towards the useful share, whatever else the answer names", async () => {
    const { deps } = scenario({
      verdict: { used_sources: [ADR, "docs/not-returned.md"] },
    });

    expect(await evaluateDocument(deps, target)).toMatchObject({
      useful_share: 0.4,
    });
  });

  it("asks for no answer and no verdict when Lore returns no context", async () => {
    const { deps, llm } = scenario({ assembled: { text: "", sources: [] } });

    expect(await evaluateDocument(deps, target)).toMatchObject({
      found: false,
      answered: false,
      useful_share: 0,
      reason: "Lore returned no context for the question",
    });
    expect(llm.calls).toHaveLength(1);
  });

  it("returns null and calls no model for a document Lore does not hold", async () => {
    const { deps, llm } = scenario({ document: null });

    expect(await evaluateDocument(deps, target)).toBeNull();
    expect(llm.calls).toEqual([]);
  });

  it("tags all three model calls with the job name context-evals", async () => {
    const { deps, llm } = scenario();

    await evaluateDocument(deps, target);

    expect(llm.calls.map((call) => call.jobName)).toEqual([
      "context-evals",
      "context-evals",
      "context-evals",
    ]);
  });

  it("shows the model at most 12000 characters of a longer document", async () => {
    const { deps, llm } = scenario({ document: "x".repeat(20_000) });

    await evaluateDocument(deps, target);

    expect(llm.calls[0].prompt).toContain("x".repeat(12_000));
    expect(llm.calls[0].prompt).not.toContain("x".repeat(12_001));
  });
});
