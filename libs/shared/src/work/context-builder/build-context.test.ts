import { describe, expect, it } from "vitest";
import { FakeLlm } from "../../outbound/llm/fake-llm.js";
import type { LlmCompleteRequest } from "../../outbound/llm/llm-provider.js";
import { buildContext, type ContextBuilderDeps } from "./build-context.js";

const TREE = [
  "apps/lore-api/src/routes/embeddings.ts",
  "apps/lore-api/src/routes/embeddings.test.ts",
  "specs/ingest-station/spec.md",
];

function scene(
  plan: Record<string, unknown>,
  overrides: Partial<ContextBuilderDeps> = {},
) {
  const llm = new FakeLlm({ text: "## Repo primer\nthe block", data: plan });
  const asked: { question: string; repo: string }[] = [];
  const opened: string[] = [];
  const looked: number[] = [];
  const grepped: string[] = [];
  const deps: ContextBuilderDeps = {
    llm,
    primer: async () => "Lore is shared context for Claude Code.",
    tree: async () => TREE,
    readFile: async (path) => {
      opened.push(path);

      return `contents of ${path}`;
    },
    answer: async (question, repo) => {
      asked.push({ question, repo });

      return `evidence for ${question} in ${repo}`;
    },
    issue: async (number) => {
      looked.push(number);

      return `issue ${number}: a user story`;
    },
    grep: async (term) => {
      grepped.push(term);

      return [
        {
          path: "apps/lore-api/src/routes/embeddings.ts",
          text: `log("${term}")`,
        },
      ];
    },
    previousWork: async (terms) => [`PR #2213 merged: ${terms.join(", ")}`],
    relatedRepos: async () => [],
    ...overrides,
  };

  return { llm, deps, asked, opened, looked, grepped };
}

const TASK = {
  query: "Drop POST /api/embed (specs/ingest-station/spec.md FR4)",
  repo: "re-cinq/lore",
  maxTokens: 8000,
};

function composeRequest(llm: FakeLlm): LlmCompleteRequest {
  return llm.calls[llm.calls.length - 1];
}

describe("buildContext", () => {
  it("answers each of the model's 2 questions from the repository's assembly and returns the block the model writes from that evidence", async () => {
    const { llm, deps, asked } = scene({
      questions: ["Who calls /api/embed?", "What does FR4 require?"],
      search_terms: ["api embed"],
      files: [],
    });

    const built = await buildContext(TASK, deps);

    expect(asked).toEqual([
      { question: "Who calls /api/embed?", repo: "re-cinq/lore" },
      { question: "What does FR4 require?", repo: "re-cinq/lore" },
    ]);
    expect(composeRequest(llm).prompt).toContain(
      "evidence for What does FR4 require? in re-cinq/lore",
    );
    expect(built.text).toBe("## Repo primer\nthe block");
  });

  it("opens each real path the model picks once and never one the repository does not hold", async () => {
    const picks = ["missing/file.ts", ...TREE, ...TREE, "specs/x/spec.md"];
    const { deps, opened } = scene({
      questions: ["q"],
      search_terms: [],
      files: picks,
    });

    await buildContext(TASK, deps);

    expect(opened).toEqual(TREE);
  });

  it("opens at most 6 of the 8 files the model picks", async () => {
    const eight = Array.from(
      { length: 8 },
      (_, index) => `src/file-${index}.ts`,
    );
    const { deps, opened } = scene(
      { questions: ["q"], search_terms: [], files: eight },
      { tree: async () => eight },
    );

    await buildContext(TASK, deps);

    expect(opened).toEqual(eight.slice(0, 6));
  });

  it("opens specs/ingest-station/spec.md once for a blob link to its line 12 and hands the 15 lines around it to the write-up", async () => {
    const forty = Array.from({ length: 40 }, (_, index) => `row ${index + 1}`);
    const { llm, deps, opened } = scene(
      {
        questions: ["q"],
        search_terms: [],
        files: ["specs/ingest-station/spec.md"],
      },
      {
        readFile: async (path) => {
          opened.push(path);

          return forty.join("\n");
        },
      },
    );

    await buildContext(
      {
        ...TASK,
        query:
          "Implements https://github.com/re-cinq/lore/blob/abc/specs/ingest-station/spec.md#L12",
      },
      deps,
    );

    expect({
      opened,
      linked: composeRequest(llm).prompt.includes('"line": 12'),
      slice: composeRequest(llm).prompt.includes("27: row 27"),
      beyond: composeRequest(llm).prompt.includes("28: row 28"),
    }).toEqual({
      opened: ["specs/ingest-station/spec.md"],
      linked: true,
      slice: true,
      beyond: false,
    });
  });

  it("looks up issue 621 the query names and hands its text to the write-up", async () => {
    const { llm, deps, looked } = scene({
      questions: ["q"],
      search_terms: [],
      files: [],
    });

    await buildContext({ ...TASK, query: "Otto issue 621 reproduction" }, deps);

    expect(looked).toEqual([621]);
    expect(composeRequest(llm).prompt).toContain("issue 621: a user story");
  });

  it("searches previous work by the model's search terms and the requirements the query names", async () => {
    const { llm, deps } = scene({
      questions: ["q"],
      search_terms: ["api embed"],
      files: [],
    });

    await buildContext(TASK, deps);

    expect(composeRequest(llm).prompt).toContain(
      "PR #2213 merged: api embed, FR4",
    );
  });

  it("greps the code for the query's quoted literal and the plan's search terms and hands the hits to the write-up", async () => {
    const { llm, deps, grepped } = scene({
      questions: ["q"],
      search_terms: ["api embed"],
      files: [],
    });

    await buildContext(
      { ...TASK, query: "Drop the 'embed route gone' log line" },
      deps,
    );

    expect(grepped).toEqual(["embed route gone", "api embed"]);
    expect(composeRequest(llm).prompt).toContain(
      '"path": "apps/lore-api/src/routes/embeddings.ts",\n   "text": "log(\\"embed route gone\\")"',
    );
  });

  it("picks files from the query before the plan is written, so the two model calls run side by side", async () => {
    const { llm, deps } = scene({
      questions: ["q"],
      search_terms: [],
      files: [],
    });

    await buildContext(TASK, deps);

    expect(
      llm.calls.slice(0, 2).map((call) => call.prompt.split("\n")[0]),
    ).toEqual([`Repository: re-cinq/lore`, `Task: ${TASK.query}`]);
  });

  it("reports the milliseconds of the plan, evidence and compose stages", async () => {
    const { deps } = scene({ questions: [], search_terms: [], files: [] });

    const built = await buildContext(TASK, deps);

    expect(Object.keys(built.stages)).toEqual(["plan", "evidence", "compose"]);
  });

  it("asks re-cinq/HALEngine, which the repository depends on, the task itself and names it to the write-up", async () => {
    const { llm, deps, asked } = scene(
      { questions: [], search_terms: [], files: [] },
      { relatedRepos: async () => ["re-cinq/HALEngine"] },
    );

    await buildContext(TASK, deps);

    expect(asked).toEqual([
      { question: TASK.query, repo: "re-cinq/HALEngine" },
    ]);
    expect(composeRequest(llm).prompt).toContain(
      "depends on: re-cinq/HALEngine",
    );
  });
});
