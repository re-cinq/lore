import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  memoryStore,
  setMemoryStore,
  selectMemoryStore,
  type MemoryStore,
} from "./memory-store.js";

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
    if (savedBackend === undefined) {
      delete process.env.LORE_MEMORY_BACKEND;
    } else {
      process.env.LORE_MEMORY_BACKEND = savedBackend;
    }
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

  it("returns a dgraph store when dgraph backend is selected with a client", () => {
    const dgraph = {
      newTxn: () => {
        throw new Error("unused");
      },
    };

    process.env.LORE_MEMORY_BACKEND = "dgraph";
    const store = selectMemoryStore({ dgraph });

    expect(store.backend).toBe("dgraph");
  });

  it("rolls back to postgres on the single value LORE_MEMORY_BACKEND=postgres", () => {
    process.env.LORE_MEMORY_BACKEND = "postgres";
    const store = selectMemoryStore({ pgPool: {} });

    expect(store.backend).toBe("postgres");
  });

  it("flips the served backend with only the LORE_MEMORY_BACKEND value (cutover and rollback)", () => {
    const dgraph = {
      newTxn: () => {
        throw new Error("unused");
      },
    };

    process.env.LORE_MEMORY_BACKEND = "dgraph";
    expect(selectMemoryStore({ pgPool: {}, dgraph }).backend).toBe("dgraph");

    process.env.LORE_MEMORY_BACKEND = "postgres";
    expect(selectMemoryStore({ pgPool: {}, dgraph }).backend).toBe("postgres");
  });

  it("throws on an unrecognized LORE_MEMORY_BACKEND value instead of silently serving postgres", () => {
    process.env.LORE_MEMORY_BACKEND = "redis";
    expect(() => selectMemoryStore({ pgPool: {} })).toThrow(
      /redis|unknown|invalid|LORE_MEMORY_BACKEND|postgres.*dgraph/i,
    );
  });
});
