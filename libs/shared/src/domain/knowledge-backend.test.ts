import { describe, it, expect } from "vitest";
import { resolveBackend, searchBackend } from "./knowledge-backend.js";

describe("resolveBackend", () => {
  it("returns utopia when the request names utopia over a repo set to both", () => {
    expect(resolveBackend("utopia", "both")).toBe("utopia");
  });

  it("returns both when the request names none and the repo is set to both", () => {
    expect(resolveBackend(undefined, "both")).toBe("both");
  });

  it("returns utopia when neither the request nor the repo names a backend", () => {
    expect(resolveBackend()).toBe("utopia");
  });
});

describe("searchBackend", () => {
  const searchLore = async () => ["lore hit"];

  it("returns Lore's hits and no notes for backend lore", async () => {
    expect(await searchBackend("lore", "search_memory", searchLore)).toEqual({
      results: ["lore hit"],
      notes: [],
    });
  });

  it("returns no hits and a no-reader note for backend utopia, never reading Lore", async () => {
    const neverRead = async (): Promise<string[]> => {
      throw new Error("Lore was read");
    };

    expect(await searchBackend("utopia", "search_memory", neverRead)).toEqual({
      results: [],
      notes: ["search_memory: no Utopia reader yet"],
    });
  });

  it("returns Lore's hits plus the no-reader note for backend both", async () => {
    expect(await searchBackend("both", "search_context", searchLore)).toEqual({
      results: ["lore hit"],
      notes: ["search_context: no Utopia reader yet"],
    });
  });

  const searchUtopia = async () => ["utopia hit"];

  it("returns Utopia's hits and no notes for backend utopia with a Utopia arm", async () => {
    const neverRead = async (): Promise<string[]> => {
      throw new Error("Lore was read");
    };

    expect(
      await searchBackend("utopia", "search_memory", neverRead, searchUtopia),
    ).toEqual({
      results: ["utopia hit"],
      notes: [],
    });
  });

  it("returns Lore's hits then Utopia's and no notes for backend both with a Utopia arm", async () => {
    expect(
      await searchBackend("both", "search_memory", searchLore, searchUtopia),
    ).toEqual({
      results: ["lore hit", "utopia hit"],
      notes: [],
    });
  });

  it("returns Lore's hits only and never reads the Utopia arm for backend lore", async () => {
    const neverRead = async (): Promise<string[]> => {
      throw new Error("Utopia was read");
    };

    expect(
      await searchBackend("lore", "search_memory", searchLore, neverRead),
    ).toEqual({
      results: ["lore hit"],
      notes: [],
    });
  });
});
