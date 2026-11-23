import { afterEach, describe, expect, it, vi } from "vitest";
import { readRepoFile } from "./github-person-read.js";

const ORIGINAL_FETCH = globalThis.fetch;

describe("readRepoFile", () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  // eslint-disable-next-line re-lint/max-comment-lines
  // lore:validates specs/github-decides-repo-access/spec.md#FR-216
  it("reads the file on GitHub with the token its env carries and returns the decoded text", async () => {
    const calls: Array<{ url: string; authorization: string }> = [];

    globalThis.fetch = vi.fn(async (input: string | URL | Request, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization") ?? "",
      });

      return Response.json({
        type: "file",
        content: Buffer.from("name: x\n").toString("base64"),
      });
    }) as typeof fetch;

    const text = await readRepoFile(
      { GITHUB_TOKEN: "ghu_person" },
      "acme/app",
      ".github/a b.yml",
    );

    expect({ text, calls }).toEqual({
      text: "name: x\n",
      calls: [
        {
          url: "https://api.github.com/repos/acme/app/contents/.github/a%20b.yml",
          authorization: "Bearer ghu_person",
        },
      ],
    });
  });

  // eslint-disable-next-line re-lint/max-comment-lines
  // lore:validates specs/github-decides-repo-access/spec.md#FR-216
  it("refuses with GitHub's status when GitHub answers an error", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("no", { status: 404 }),
    ) as typeof fetch;

    await expect(
      readRepoFile({ GITHUB_TOKEN: "ghu_person" }, "acme/app", "x"),
    ).rejects.toMatchObject({ status: 404 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
