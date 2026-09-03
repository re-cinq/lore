import { describe, it, expect } from "vitest";
import type { Agent } from "@re-cinq/agent-contracts";
import type { LoreTaskSpec } from "../project/agents/k8s-port.js";
import {
  AgentCrBackend,
  specToAgent,
  agentCrName,
  TASK_ID_LABEL,
  type AgentApi,
  type TokenProvisioner,
} from "./agent-backend.js";
import { CONTEXT_BOOTSTRAP } from "../agents/recipe-prompt.js";

const baseSpec: LoreTaskSpec = {
  taskId: "abcdef1234567890",
  taskType: "implementation",
  description: "Implement the thing",
  prompt: "do it",
  targetRepo: "re-cinq/lore",
  branch: "lore/impl-abcdef12",
};

class FakeAgentApi implements AgentApi {
  readonly created: Agent[] = [];
  constructor(
    private readonly createResult: { name: string; created: boolean } = {
      name: agentCrName(baseSpec.taskId),
      created: true,
    },
    private readonly listResult: Agent[] | Error = [],
  ) {}
  async create(agent: Agent) {
    this.created.push(agent);

    return this.createResult;
  }
  async listByLabel(_selector: string): Promise<Agent[]> {
    if (this.listResult instanceof Error) {
      throw this.listResult;
    }

    return this.listResult;
  }
}

describe("specToAgent", () => {
  it("maps a task to an Agent CR: stationRef=taskType, task-id label, parameters", () => {
    expect(specToAgent(baseSpec)).toEqual({
      metadata: {
        name: "agent-abcdef12",
        labels: {
          "lore.re-cinq.com/task-id": "abcdef1234567890",
          "lore.re-cinq.com/task-type": "implementation",
        },
      },
      spec: {
        stationRef: "implementation",
        taskId: "abcdef1234567890",
        targetRepo: "re-cinq/lore",
        branch: "lore/impl-abcdef12",
        parameters: {
          description: "Implement the thing",
          prompt: "do it",
          context: CONTEXT_BOOTSTRAP,
        },
      },
    });
  });

  it("honours an explicit name, extraLabels, and prNumber → pr_number parameter", () => {
    const agent = specToAgent({
      ...baseSpec,
      name: "review-run-7",
      prNumber: 7,
      extraLabels: { "lore.re-cinq.com/dark-factory": "true" },
    });

    expect(agent.metadata?.name).toBe("review-run-7");
    expect(agent.metadata?.labels?.["lore.re-cinq.com/dark-factory"]).toBe(
      "true",
    );
    expect(agent.spec?.parameters?.pr_number).toBe("7");
  });
});

describe("AgentCrBackend.launch", () => {
  it("creates the Agent and returns ref + launched, omitting completion", async () => {
    const api = new FakeAgentApi({ name: "agent-abcdef12", created: true });
    const result = await new AgentCrBackend(api).launch(baseSpec);

    expect(result).toEqual({ ref: "agent-abcdef12", launched: true });
    expect(api.created[0].metadata?.labels?.[TASK_ID_LABEL]).toBe(
      baseSpec.taskId,
    );
  });

  it("maps an already-existing CR (409) to launched:false", async () => {
    const api = new FakeAgentApi({ name: "agent-abcdef12", created: false });

    expect(await new AgentCrBackend(api).launch(baseSpec)).toEqual({
      ref: "agent-abcdef12",
      launched: false,
    });
  });
});

describe("AgentCrBackend.launch — per-task token (#697)", () => {
  class FakeProvisioner implements TokenProvisioner {
    readonly seen: LoreTaskSpec[] = [];
    constructor(private readonly stationRef: string | undefined) {}
    async provision(spec: LoreTaskSpec) {
      this.seen.push(spec);

      return this.stationRef;
    }
  }

  it("runs the Agent on the per-task Station the provisioner returns", async () => {
    const api = new FakeAgentApi();
    const provisioner = new FakeProvisioner("pt-abcdef12");

    await new AgentCrBackend(api, provisioner).launch(baseSpec);
    expect(provisioner.seen).toEqual([baseSpec]);
    expect(api.created[0].spec?.stationRef).toBe("pt-abcdef12");
  });

  it("falls back to the catalog Station when the provisioner returns undefined", async () => {
    const api = new FakeAgentApi();

    await new AgentCrBackend(api, new FakeProvisioner(undefined)).launch(
      baseSpec,
    );
    expect(api.created[0].spec?.stationRef).toBe("implementation");
  });

  it("skips provisioning for a task that targets no repo", async () => {
    const api = new FakeAgentApi();
    const provisioner = new FakeProvisioner("pt-abcdef12");

    await new AgentCrBackend(api, provisioner).launch({
      ...baseSpec,
      targetRepo: "",
    });
    expect(provisioner.seen).toEqual([]);
    expect(api.created[0].spec?.stationRef).toBe("implementation");
  });

  it("skips provisioning for a clone:false spec even when it targets a repo — a detect node's lease-key branch is no git ref, so a forced checkout would fail its init", async () => {
    const api = new FakeAgentApi();
    const provisioner = new FakeProvisioner("pt-abcdef12");

    await new AgentCrBackend(api, provisioner).launch({
      ...baseSpec,
      stationRef: "def-detect",
      clone: false,
    });
    expect(provisioner.seen).toEqual([]);
    expect(api.created[0].spec?.stationRef).toBe("def-detect");
  });
});

describe("AgentCrBackend.isActive", () => {
  const running: Agent = { status: { phase: "Running" } };
  const succeeded: Agent = { status: { phase: "Succeeded" } };

  it("returns false when no Agent carries the task-id label (orphaned)", async () => {
    expect(
      await new AgentCrBackend(new FakeAgentApi(undefined, [])).isActive("t1"),
    ).toBe(false);
  });

  it("returns true when a matching Agent is not yet terminal", async () => {
    const api = new FakeAgentApi(undefined, [succeeded, running]);

    expect(await new AgentCrBackend(api).isActive("t1")).toBe(true);
  });

  it("returns false when every matching Agent is terminal", async () => {
    const api = new FakeAgentApi(undefined, [succeeded]);

    expect(await new AgentCrBackend(api).isActive("t1")).toBe(false);
  });

  it("returns true (conservative) when the probe fails", async () => {
    const api = new FakeAgentApi(undefined, new Error("kube unreachable"));

    expect(await new AgentCrBackend(api).isActive("t1")).toBe(true);
  });
});
