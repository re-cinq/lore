import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerExplainCodeTool } from "./explain-code.js";

const fetchMock = vi.fn();
const explainIn = (mode: "full" | "agent") =>
  toolHandlers(registerExplainCodeTool, mode)["lore_explain_code"];
const textOf = async (mode: "full" | "agent", args: Record<string, unknown>) =>
  (await explainIn(mode)(args)).content[0].text;

const answered = (body: unknown) =>
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });

describe("lore_explain_code", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
    vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers the explanation followed by the statements it rests on", async () => {
    answered({
      answer: "It spins the widget.",
      statements: [{ text: "The widget spins.", via: "covered" }],
      model: "m",
    });

    expect(
      await textOf("agent", {
        repo: "re-cinq/lore",
        path: "src/widget.ts",
        start_line: 1,
        end_line: 3,
        code: "spin()",
      }),
    ).toBe(
      "It spins the widget.\n\nSpec statements:\n- The widget spins. (covered)",
    );
  });

  it("answers I don't know alone when no statement links the lines", async () => {
    answered({ answer: "I don't know: no link.", statements: [], model: null });

    expect(
      await textOf("agent", {
        repo: "re-cinq/lore",
        path: "src/widget.ts",
        start_line: 1,
        end_line: 3,
        code: "spin()",
      }),
    ).toBe("I don't know: no link.");
  });

  it("posts the span and the code to the repo's explain route", async () => {
    answered({ answer: "a", statements: [], model: null });

    await textOf("agent", {
      repo: "re-cinq/lore",
      path: "src/widget.ts",
      start_line: 1,
      end_line: 3,
      code: "spin()",
    });

    expect(fetchMock.mock.calls[0]).toMatchObject([
      "https://lore-api.example.com/api/repos/re-cinq/lore/explain",
      {
        method: "POST",
        body: JSON.stringify({
          path: "src/widget.ts",
          start_line: 1,
          end_line: 3,
          code: "spin()",
        }),
      },
    ]);
  });

  it("reads lines 1-2 of package.json from the checkout when no code is given", async () => {
    answered({ answer: "a", statements: [], model: null });

    await textOf("full", {
      repo: "re-cinq/lore",
      path: "package.json",
      start_line: 1,
      end_line: 2,
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).code).toMatch(
      /^\{\n\s+"name": /,
    );
  });

  it("asks for the code when the file is not in the checkout", async () => {
    expect(
      await textOf("full", {
        repo: "re-cinq/lore",
        path: "no/such/file.ts",
        start_line: 1,
        end_line: 2,
      }),
    ).toBe(
      "Could not read no/such/file.ts lines 1-2. Pass the selected code as `code`.",
    );
  });
});
