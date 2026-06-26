import { describe, it, expect } from "vitest";
import type { LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";
import { RoutingStationBackend } from "./routing-station-backend.js";

class FakeBackend implements StationBackend {
  readonly launched: string[] = [];
  readonly probed: string[] = [];
  constructor(private readonly ref: string) {}
  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    this.launched.push(spec.taskId);
    return { ref: this.ref, launched: true };
  }
  async isActive(taskId: string): Promise<boolean> {
    this.probed.push(taskId);
    return true;
  }
}

const spec = (taskId: string): LoreTaskSpec => ({
  taskId,
  taskType: "implementation",
  description: "",
  prompt: "",
  targetRepo: "o/r",
  branch: "b",
});

describe("RoutingStationBackend", () => {
  it("launches on the backend the route picks", async () => {
    const agentCr = new FakeBackend("a");
    const loretask = new FakeBackend("l");

    const toAgent = new RoutingStationBackend({ "agent-cr": agentCr, loretask }, () => "agent-cr");
    const toLoretask = new RoutingStationBackend({ "agent-cr": agentCr, loretask }, () => "loretask");

    expect(await toAgent.launch(spec("use-agent"))).toEqual({ ref: "a", launched: true });
    expect(await toLoretask.launch(spec("other"))).toEqual({ ref: "l", launched: true });
    expect(agentCr.launched).toEqual(["use-agent"]);
    expect(loretask.launched).toEqual(["other"]);
  });

  it("probes isActive on the routed backend", async () => {
    const agentCr = new FakeBackend("a");
    const loretask = new FakeBackend("l");
    const router = new RoutingStationBackend({ "agent-cr": agentCr, loretask }, () => "agent-cr");
    expect(await router.isActive("t")).toBe(true);
    expect(agentCr.probed).toEqual(["t"]);
    expect(loretask.probed).toEqual([]);
  });
});
