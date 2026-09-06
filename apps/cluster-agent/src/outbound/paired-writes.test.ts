import { describe, it, expect } from "vitest";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { applyCatalogPair, type CatalogWriter } from "./paired-writes.js";

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
