import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();

vi.mock("./api/client", () => ({ apiFetch }));

const { readRepoFile } = await import("./repo-file");

beforeEach(() => apiFetch.mockReset());

describe("readRepoFile", () => {
  // eslint-disable-next-line re-lint/max-comment-lines
  // lore:validates specs/github-decides-repo-access/spec.md#FR-141
  it("reads the file through lore-api's /github/file route, never GitHub", async () => {
    apiFetch.mockResolvedValue({ status: "ok", data: { content: "a\nb" } });

    const text = await readRepoFile("acme/app", "src/a b.ts");

    expect(text).toBe("a\nb");
    expect(apiFetch).toHaveBeenCalledWith(
      "lore-api",
      "/api/repos/acme/app/github/file?path=src%2Fa%20b.ts",
    );
  });

  it("is null when lore-api cannot give the file", async () => {
    apiFetch.mockResolvedValue({ status: "error", message: "x", code: 404 });

    expect(await readRepoFile("acme/app", "gone.ts")).toBeNull();
  });
});
