import { describe, it, expect } from "vitest";
import { ShadowMemoryStore } from "./shadow-memory-store.js";
import type { MemoryStore, WriteResult } from "./memory-store.js";

class FakeStore implements MemoryStore {
  readonly backend = "postgres" as const;

  constructor(private readonly readValue: string) {}

  async readMemory(_key: string, _agentId: string): Promise<any> {
    return this.readValue;
  }

  async writeMemory(): Promise<WriteResult> {
    throw new Error("unused in this test");
  }

  async deleteMemory(): Promise<{ key: string; deleted: boolean }> {
    throw new Error("unused in this test");
  }

  async listMemories(): Promise<{ memories: any[]; total: number }> {
    throw new Error("unused in this test");
  }
}

class ThrowingStore implements MemoryStore {
  readonly backend = "postgres" as const;

  async readMemory(_key: string, _agentId: string): Promise<any> {
    throw new Error("shadow down");
  }

  async writeMemory(): Promise<WriteResult> {
    throw new Error("unused in this test");
  }

  async deleteMemory(): Promise<{ key: string; deleted: boolean }> {
    throw new Error("unused in this test");
  }

  async listMemories(): Promise<{ memories: any[]; total: number }> {
    throw new Error("unused in this test");
  }
}

describe("ShadowMemoryStore", () => {
  it("serves readMemory from the primary, not the shadow", async () => {
    const primary = new FakeStore("from-primary");
    const shadow = new FakeStore("from-shadow");

    const result = await new ShadowMemoryStore(primary, shadow).readMemory(
      "k",
      "agent-1",
    );

    expect(result).toBe("from-primary");
  });

  it("emits lore.memory.shadow_divergence when primary and shadow differ", async () => {
    const primary = new FakeStore("primary-value");
    const shadow = new FakeStore("shadow-value");
    const recorded: string[] = [];
    const metrics = {
      increment: (name: string) => {
        recorded.push(name);
      },
    };

    await new ShadowMemoryStore(primary, shadow, { metrics }).readMemory(
      "k",
      "agent-1",
    );

    expect(recorded).toContain("lore.memory.shadow_divergence");
  });

  it("serves the primary result when the shadow read throws", async () => {
    const primary = new FakeStore("primary-value");
    const shadowThatThrows = new ThrowingStore();

    const result = await new ShadowMemoryStore(
      primary,
      shadowThatThrows,
    ).readMemory("k", "agent-1");

    expect(result).toBe("primary-value");
  });

  it("logs the shadow error through the injected sink when the shadow read throws", async () => {
    const primary = new FakeStore("primary-value");
    const shadow = new ThrowingStore();
    const logged: unknown[] = [];
    const logger = {
      error: (...args: unknown[]) => {
        logged.push(args);
      },
    };

    const result = await new ShadowMemoryStore(primary, shadow, {
      logger,
    }).readMemory("k", "agent-1");

    expect(result).toBe("primary-value");
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged) + String(logged)).toMatch(
      /shadow|shadow down/i,
    );
  });

  it("emits no divergence metric when primary and shadow agree", async () => {
    const primary = new FakeStore("same-value");
    const shadow = new FakeStore("same-value");
    const recorded: string[] = [];
    const metrics = {
      increment: (name: string) => {
        recorded.push(name);
      },
    };

    await new ShadowMemoryStore(primary, shadow, { metrics }).readMemory(
      "k",
      "agent-1",
    );

    expect(recorded).toEqual([]);
  });

  it("emits no divergence metric when the shadow read throws (a throw is not a divergence)", async () => {
    const primary = new FakeStore("primary-value");
    const shadow = new ThrowingStore();
    const recorded: string[] = [];
    const metrics = {
      increment: (name: string) => {
        recorded.push(name);
      },
    };
    const logger = { error: () => {} };

    await new ShadowMemoryStore(primary, shadow, {
      metrics,
      logger,
    }).readMemory("k", "agent-1");

    expect(recorded).toEqual([]);
  });
});
