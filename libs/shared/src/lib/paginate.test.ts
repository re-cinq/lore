import { describe, it, expect } from "vitest";
import { collectPages, forEachPage, type Page } from "./paginate.js";

function pages(scripted: Page<string>[]) {
  const tokensSeen: (string | undefined)[] = [];
  let next = 0;

  return {
    tokensSeen,
    fetch: async (continueToken?: string): Promise<Page<string>> => {
      tokensSeen.push(continueToken);

      return scripted[next++];
    },
  };
}

describe("forEachPage", () => {
  it("hands each page to onPage in order", async () => {
    const source = pages([
      { items: ["a", "b"], continueToken: "t1" },
      { items: ["c"] },
    ]);
    const seen: string[][] = [];

    await forEachPage(source.fetch, async (items) => {
      seen.push(items);
    });

    expect(seen).toEqual([["a", "b"], ["c"]]);
  });

  it("passes undefined first, then each page's continue token", async () => {
    const source = pages([
      { items: [], continueToken: "t1" },
      { items: [], continueToken: "t2" },
      { items: [] },
    ]);

    await forEachPage(source.fetch, async () => {});

    expect(source.tokensSeen).toEqual([undefined, "t1", "t2"]);
  });

  it("fetches once when the first page carries no continue token", async () => {
    const source = pages([{ items: ["only"] }]);

    await forEachPage(source.fetch, async () => {});

    expect(source.tokensSeen).toEqual([undefined]);
  });
});

describe("collectPages", () => {
  it("flattens every page into one list", async () => {
    const source = pages([
      { items: ["a"], continueToken: "t1" },
      { items: ["b", "c"] },
    ]);

    expect(await collectPages(source.fetch)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list when the only page is empty", async () => {
    const source = pages([{ items: [] }]);

    expect(await collectPages(source.fetch)).toEqual([]);
  });
});
