import { describe, it, expect } from "vitest";
import { codeTokens } from "./code-tokens";
import { fencedBlocks } from "./fenced-blocks";
import { linesOf } from "./ranges";

function tokensOf(text: string): [string, string][] {
  return codeTokens(text, fencedBlocks(linesOf(text))).map((token) => [
    token.className,
    text.slice(token.from, token.to),
  ]);
}

describe("codeTokens", () => {
  it("returns a keyword, a string and a comment for a ts fence declaring const name as lore with a greet comment", () => {
    expect(tokensOf('```ts\nconst name = "lore"; // greet\n```')).toEqual([
      ["hljs-keyword", "const"],
      ["hljs-string", '"lore"'],
      ["hljs-comment", "// greet"],
    ]);
  });

  it("returns the two comments of the cli-design bash fence in text order", () => {
    const fence =
      "```bash\n# Bad — which is source, which is destination?\nmycli copy myapp backup\n\n# Good — explicit\nmycli copy --from myapp --to backup\n```";

    expect(
      tokensOf(fence).filter(([className]) => className === "hljs-comment"),
    ).toEqual([
      ["hljs-comment", "# Bad — which is source, which is destination?"],
      ["hljs-comment", "# Good — explicit"],
    ]);
  });

  it("returns the comment of a 'shell' fence of '# Good — explicit' as bash does", () => {
    expect(tokensOf("```shell\n# Good — explicit\n```")).toEqual([
      ["hljs-comment", "# Good — explicit"],
    ]);
  });

  it("returns the string before the substitution inside it for a ts template literal of x and b", () => {
    const tokens = tokensOf("```ts\nconst a = `x ${b}`;\n```");

    expect(tokens.map(([className]) => className)).toEqual([
      "hljs-keyword",
      "hljs-string",
      "hljs-subst",
    ]);
  });

  it("returns no tokens for a fence with no language", () => {
    expect(tokensOf('```\nconst name = "lore";\n```')).toEqual([]);
  });

  it("returns no tokens for the prose around a fence", () => {
    expect(tokensOf('const name = "lore";\n\n```\nplain\n```\n')).toEqual([]);
  });

  it("returns the tokens of each fence from its own language", () => {
    const tokens = tokensOf(
      '```ts\nconst a = "x";\n```\n\n```json\n{"ok": true}\n```',
    );

    expect(
      tokens.filter(([className]) => /string|attr|literal/.test(className)),
    ).toEqual([
      ["hljs-string", '"x"'],
      ["hljs-attr", '"ok"'],
      ["hljs-literal", "true"],
    ]);
  });

  it("returns tokens only inside the content lines of an unclosed fence", () => {
    const text = "```ts\nconst a = 1;";

    expect(
      codeTokens(text, fencedBlocks(linesOf(text))).every(
        (token) => token.from >= 6 && token.to <= text.length,
      ),
    ).toBe(true);
  });

  it("returns a repeated ts fence's keyword at its own position after prose pushes it down", () => {
    const fence = "```ts\nconst a = 1;\n```";

    expect(tokensOf(`${fence}\n\nSome prose.\n\n${fence}`)).toEqual([
      ["hljs-keyword", "const"],
      ["hljs-number", "1"],
      ["hljs-keyword", "const"],
      ["hljs-number", "1"],
    ]);
  });

  it("returns no tokens for a fence of language 'klingon'", () => {
    expect(tokensOf('```klingon\nconst name = "lore";\n```')).toEqual([]);
  });
});
