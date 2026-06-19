import { describe, it, expect } from "vitest";
import { buildAgentJob } from "./job-builder.js";
import type { Agent, AgentDefinition, Station } from "./cr-types.js";

const agentDef: AgentDefinition = {
  metadata: { name: "bug-fixer" },
  spec: { model: "claude-sonnet-4-6", prompt: "Fix {ticket} on {branch}.", permission_mode: "auto" },
};

const station: Station = {
  metadata: { name: "node-fixer" },
  spec: {
    agentDefRef: "bug-fixer",
    deadlineMinutes: 15,
    template: {
      spec: {
        containers: [{ name: "agent", image: "busybox:1.36" }],
      },
    },
  },
};

const agent: Agent = {
  metadata: { name: "bug-fixer-run-abc", uid: "uid-1" },
  spec: { stationRef: "node-fixer", targetRepo: "re-cinq/lore", branch: "fix/x", parameters: { ticket: "ENG-1", branch: "fix/x" } },
};

describe("buildAgentJob", () => {
  it("stamps a Job from the Station's pod template with the rendered prompt wired into the agent container", () => {
    const job = buildAgentJob(agent, station, agentDef, "lore-agents");

    expect(job.metadata?.name).toBe("agent-job-bug-fixer-run-abc");
    expect(job.spec?.activeDeadlineSeconds).toBe(900); // 15 * 60
    expect(job.spec?.ttlSecondsAfterFinished).toBe(300);
    expect(job.spec?.backoffLimit).toBe(1);
    expect(job.spec?.template.spec?.restartPolicy).toBe("Never");

    const container = job.spec?.template.spec?.containers.find((c) => c.name === "agent");
    expect(container?.image).toBe("busybox:1.36"); // from the Station template
    const env = Object.fromEntries((container?.env ?? []).map((e) => [e.name, e.value]));
    expect(env).toMatchObject({
      LORE_PROMPT: "Fix ENG-1 on fix/x.",
      LORE_MODEL: "claude-sonnet-4-6",
      LORE_PERMISSION_MODE: "auto",
      TARGET_REPO: "re-cinq/lore",
      BRANCH_NAME: "fix/x",
    });
  });

  it("labels the pod as a job component and sets an ownerReference back to the Agent", () => {
    const job = buildAgentJob(agent, station, agentDef, "lore-agents");

    expect(job.spec?.template.metadata?.labels).toMatchObject({
      "lore.re-cinq.com/component": "job",
      "lore.re-cinq.com/agent": "bug-fixer-run-abc",
      "lore.re-cinq.com/station": "node-fixer",
    });
    expect(job.metadata?.ownerReferences?.[0]).toMatchObject({
      kind: "Agent",
      name: "bug-fixer-run-abc",
      uid: "uid-1",
      controller: true,
    });
  });

  it("creates an 'agent' container when the template declares none", () => {
    const bare: Station = { metadata: { name: "s" }, spec: { agentDefRef: "bug-fixer", template: { spec: { containers: [] } } } };
    const job = buildAgentJob(agent, bare, agentDef, "lore-agents");
    const container = job.spec?.template.spec?.containers.find((c) => c.name === "agent");
    expect(container).toBeDefined();
    expect(job.spec?.activeDeadlineSeconds).toBe(1800); // default 30 * 60
  });

  it("does not mutate the Station's template", () => {
    const snapshot = JSON.stringify(station.spec.template);
    buildAgentJob(agent, station, agentDef, "lore-agents");
    expect(JSON.stringify(station.spec.template)).toBe(snapshot);
  });
});
