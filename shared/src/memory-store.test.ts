import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { memoryStore, setMemoryStore, selectMemoryStore, type MemoryStore } from "./memory-store.js";

describe("memoryStore", () => {
  // Ordered: the unset-throw assertion must run before any setMemoryStore call,
  // since the registry is a module-global singleton.
  it("throws when no store has been set", () => {
    expect(() => memoryStore()).toThrow();
  });

  it("returns the store registered via setMemoryStore", () => {
    // Registry identity is the only contract under test here, so a
    // backend-only stand-in stands in for a full MemoryStore.
    const registered = { backend: "postgres" } as unknown as MemoryStore;
    setMemoryStore(registered);
    expect(memoryStore()).toBe(registered);
  });
});

describe("selectMemoryStore", () => {
  let savedBackend: string | undefined;

  beforeEach(() => {
    savedBackend = process.env.LORE_MEMORY_BACKEND;
    delete process.env.LORE_MEMORY_BACKEND;
  });

  afterEach(() => {
    if (savedBackend === undefined) delete process.env.LORE_MEMORY_BACKEND;
    else process.env.LORE_MEMORY_BACKEND = savedBackend;
  });

  it("returns a postgres store when LORE_MEMORY_BACKEND is unset", () => {
    const store = selectMemoryStore({ pgPool: {} });
    expect(store.backend).toBe("postgres");
  });

  it("throws when postgres backend is selected without a pgPool", () => {
    expect(() => selectMemoryStore({})).toThrow(/postgres|pool/i);
  });

  it("throws when dgraph backend is selected without a dgraph client", () => {
    process.env.LORE_MEMORY_BACKEND = "dgraph";
    expect(() => selectMemoryStore({ pgPool: {} })).toThrow(/dgraph/i);
  });
});
