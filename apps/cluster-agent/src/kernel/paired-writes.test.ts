// The two read-modify-writes that the deps object composes.
//
// They lived inline in the composition root, which is excluded from coverage
// as an IO shell — and both carried a defect nobody could see: the status
// patch had no conflict retry, and the catalog apply wrote its pair in the
// order its own sibling's comment argued against. Decision logic in an IO
// shell is decision logic nobody tests, so it is out here now.
import { describe, it, expect } from "vitest";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import {
  applyCatalogPair,
  patchAgentStatus,
  type CatalogWriter,
  type StatusClient,
} from "./paired-writes.js";

function conflict(): Error {
  return Object.assign(new Error("the object has been modified"), {
    code: 409,
  });
}

/** A status subresource that rejects the first `conflicts` replaces. */
function statusClient(conflicts: number, live: Record<string, unknown> = {}) {
  const replaced: Record<string, unknown>[] = [];
  let reads = 0;
  let left = conflicts;

  const client: StatusClient = {
    getNamespacedCustomObjectStatus: async () => {
      reads++;

      return { metadata: { name: "cr-1" }, status: live };
    },
    replaceNamespacedCustomObjectStatus: async (args) => {
      if (left-- > 0) {
        throw conflict();
      }
      replaced.push((args as { body: Record<string, unknown> }).body);

      return {};
    },
  };

  return { client, replaced, reads: () => reads };
}

describe("patchAgentStatus", () => {
  it("merges the patch onto the live status and replaces once", async () => {
    const co = statusClient(0, { phase: "Running" });

    await patchAgentStatus(co.client, "cr-1", { prUrl: "u" });

    expect(co.replaced).toEqual([
      {
        metadata: { name: "cr-1" },
        status: { phase: "Running", prUrl: "u" },
      },
    ]);
  });

  it("re-reads and retries when a concurrent write conflicts", async () => {
    const co = statusClient(2, { phase: "Running" });

    await patchAgentStatus(co.client, "cr-1", { prUrl: "u" });

    expect({ reads: co.reads(), replaced: co.replaced.length }).toEqual({
      reads: 3,
      replaced: 1,
    });
  });

  it("gives up after the conflict ladder rather than spinning forever", async () => {
    const co = statusClient(99);

    await expect(
      patchAgentStatus(co.client, "cr-1", { prUrl: "u" }),
    ).rejects.toThrow(/patch status of agents\/cr-1 failed with 409/);
    expect(co.reads()).toBe(5);
  });

  it("does not retry a refusal that is not a conflict", async () => {
    const co = statusClient(0);
    const denied: StatusClient = {
      ...co.client,
      replaceNamespacedCustomObjectStatus: async () => {
        throw Object.assign(new Error("Forbidden"), { code: 403 });
      },
    };

    await expect(patchAgentStatus(denied, "cr-1", {})).rejects.toThrow(
      /403.*Role is missing this rule/,
    );
  });
});

/** A catalog recording the order it was written in. */
function catalogWriter() {
  const order: string[] = [];
  const writer: CatalogWriter = {
    getStation: async () => null,
    getAgentDefinition: async () => null,
    applyStation: async () => {
      order.push("station");
    },
    applyAgentDefinition: async () => {
      order.push("agentDefinition");
    },
  };

  return { writer, order };
}

const PAIR = {
  agentDefinition: { metadata: { name: "pt-1" } } as AgentDefinition,
  station: { metadata: { name: "pt-1" } } as Station,
};

describe("applyCatalogPair", () => {
  it("writes the station before the agent definition that points at it", async () => {
    const catalog = catalogWriter();

    await applyCatalogPair(catalog.writer, PAIR);

    expect(catalog.order).toEqual(["station", "agentDefinition"]);
  });

  it("does not write the agent definition when the station write fails", async () => {
    const catalog = catalogWriter();

    await expect(
      applyCatalogPair(
        {
          ...catalog.writer,
          applyStation: async () => {
            throw new Error("apiserver said no");
          },
        },
        PAIR,
      ),
    ).rejects.toThrow("apiserver said no");
    expect(catalog.order).toEqual([]);
  });
});

describe("applyCatalogPair — merging onto the live object", () => {
  it("carries labels the controller set onto the object being written", async () => {
    const live = {
      metadata: {
        name: "pt-1",
        labels: { "set-by": "the-controller" },
      },
    };
    const written: Station[] = [];

    await applyCatalogPair(
      {
        getStation: async () => live as Station,
        getAgentDefinition: async () => null,
        applyStation: async (s) => {
          written.push(s);
        },
        applyAgentDefinition: async () => {},
      },
      PAIR,
    );

    expect(written[0]?.metadata?.labels).toEqual({
      "set-by": "the-controller",
    });
  });
});
