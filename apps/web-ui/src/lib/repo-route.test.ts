import { describe, it, expect, vi, afterEach } from "vitest";
import { repoRoute } from "./repo-route";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repoRoute", () => {
  it("hands the handler owner/repo joined and the request query string", async () => {
    const seen: string[] = [];
    const route = repoRoute("ctx", async (fullName, searchParams) => {
      seen.push(fullName, searchParams.get("offset") ?? "");

      return new Response("ok");
    });

    const res = await route(new Request("https://ui.test/x?offset=40"), {
      params: Promise.resolve({ owner: "re-cinq", repo: "lore" }),
    });

    expect(seen).toEqual(["re-cinq/lore", "40"]);
    expect(await res.text()).toEqual("ok");
  });

  it("answers 500 carrying the message when the handler throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = repoRoute("repo-events", async () => {
      throw new Error("upstream down");
    });

    const res = await route(new Request("https://ui.test/x"), {
      params: Promise.resolve({ owner: "re-cinq", repo: "lore" }),
    });

    expect(res.status).toEqual(500);
    expect(await res.json()).toEqual({ error: "upstream down" });
  });
});
