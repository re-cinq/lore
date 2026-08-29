import { describe, expect, it } from "vitest";
import { clusterAgentCredentials } from "./agent-crd-k8s.js";

describe("clusterAgentCredentials", () => {
  it("presents the service-to-service token the cluster-agent's guard mounts", () => {
    expect(
      clusterAgentCredentials({
        CLUSTER_AGENT_URL: "http://lore-cluster-agent:8080",
        LORE_AGENT_INTERNAL_TOKEN: "internal-secret",
        LORE_INGEST_TOKEN: "ingest-secret",
      }),
    ).toEqual({
      baseUrl: "http://lore-cluster-agent:8080",
      token: "internal-secret",
    });
  });

  it("falls back to the ingest token where one secret serves both ends", () => {
    expect(
      clusterAgentCredentials({
        CLUSTER_AGENT_URL: "http://localhost:3005",
        LORE_INGEST_TOKEN: "lore-local-dev-token",
      }),
    ).toEqual({
      baseUrl: "http://localhost:3005",
      token: "lore-local-dev-token",
    });
  });

  it("carries an empty base url and no token when neither is set", () => {
    expect(clusterAgentCredentials({})).toEqual({
      baseUrl: "",
      token: undefined,
    });
  });
});
