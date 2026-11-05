import { describe, expect, it } from "vitest";
import type { Octokit } from "octokit";
import { searchCode } from "./platform-github-code-search.js";

describe("searchCode", () => {
  it("asks GitHub for 5 files of re-cinq/lore holding the quoted term and returns each path with its fragments", async () => {
    const asked: unknown[] = [];
    const ok = {
      rest: {
        search: {
          code: async (params: unknown) => {
            asked.push(params);

            return {
              data: {
                items: [
                  {
                    path: "apps/lore-api/src/work/utopia/repo-mirror.ts",
                    text_matches: [
                      { fragment: 'log("source extraction switch")' },
                      { fragment: "answered 401" },
                    ],
                  },
                  { path: "README.md" },
                ],
              },
            };
          },
        },
      },
    } as unknown as Octokit;

    const matches = await searchCode(
      ok,
      "re-cinq/lore",
      "source extraction switch",
    );

    expect(asked).toEqual([
      {
        q: '"source extraction switch" repo:re-cinq/lore',
        per_page: 5,
        headers: { accept: "application/vnd.github.text-match+json" },
      },
    ]);
    expect(matches).toEqual([
      {
        path: "apps/lore-api/src/work/utopia/repo-mirror.ts",
        text: 'log("source extraction switch")\nanswered 401',
      },
      { path: "README.md", text: "" },
    ]);
  });
});
