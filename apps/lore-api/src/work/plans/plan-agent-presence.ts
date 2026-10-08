// Shows the planning agent on its plan for as long as one of the planning line's agent stations is working on it, so the plan's people see it is being worked on from the moment the floor opens the visit, not from the agent's first edit. One floor-wide watch, one owner of the agent's presence (see specs/7-feature-planning/spec.md FR-18).
import type { FloorWatch, RunView, VisitView } from "@re-cinq/floor-client";
import { startValue } from "@re-cinq/lore-shared/review/floor-review-runs.js";

export const PLANNING_LINE = "feature-planning";

/** The agent nodes of the planning line, by what the agent is doing on the plan; a node not named here is a service or a person's step and shows nobody. */
export const AGENT_STEPS: Readonly<Record<string, string>> = {
  analyze: "writing the plan",
  validate: "checking the plan",
  "analyse-specs": "writing the spec",
  draft: "writing the spec",
  write: "writing the spec",
  rework: "writing the spec",
  "qa-generate": "checking the spec",
  "qa-answer": "checking the spec",
  "qa-recheck": "checking the spec",
  decompose: "splitting into tasks",
};

const AGENT_COLOR = "hsl(200 65% 45%)";

export interface AgentShown {
  planId: string;
  /** The name the agent shows under, or null when no agent step is open. */
  name: string | null;
}

/** Who a planning run shows on its plan; null for a run of another line or one keyed on no plan. */
export function agentShownOn(
  run: RunView,
  visits: readonly VisitView[],
): AgentShown | null {
  const planId = startValue(run, "plan_id");

  if (run.lineId !== PLANNING_LINE || !planId) {
    return null;
  }
  const working = run.finishedAt ? [] : visits.filter(isOpenAgentStep);
  const step = working.at(-1);

  return {
    planId,
    name: step ? `Planning agent (${AGENT_STEPS[step.nodeId]})` : null,
  };
}

function isOpenAgentStep(visit: VisitView): boolean {
  return visit.report === null && visit.nodeId in AGENT_STEPS;
}

export interface PresenceWriter {
  openPresence(request: {
    planId: string;
    user: { name: string; color: string };
  }): Promise<unknown>;
  closePresence(request: { planId: string }): Promise<unknown>;
}

export interface PlanAgentPresenceDeps {
  watchFloor(): FloorWatch;
  readRun(runId: string): Promise<{ run: RunView; visits: VisitView[] } | null>;
  /** The ids of the planning runs still open, read when the floor says it may have missed something. */
  openPlanningRuns(): Promise<string[]>;
  writer: PresenceWriter;
}

export class PlanAgentPresence {
  /** The plans the agent is shown on, by the run that shows it and the name it shows under. */
  private readonly shown = new Map<string, { runId: string; name: string }>();
  private readonly queued = new Set<string>();
  private work: Promise<void> = Promise.resolve();
  private watch: FloorWatch | null = null;

  constructor(private readonly deps: PlanAgentPresenceDeps) {}

  start(): void {
    this.watch = this.deps.watchFloor();
    void this.follow(this.watch);
  }

  stop(): void {
    this.watch?.stop();
    this.watch = null;
  }

  /** Resolves once every change heard so far has been applied. */
  settled(): Promise<void> {
    return this.work;
  }

  private async follow(watch: FloorWatch): Promise<void> {
    try {
      for await (const frame of watch) {
        if (frame.type === "resync") {
          this.enqueue(() => this.resync());
          continue;
        }
        this.refreshLater(frame.runId);
      }
    } catch (err) {
      console.warn(`[plan-presence] floor watch failed: ${String(err)}`);
    }
  }

  /** A run already waiting in the queue is read once, after every change that came in while it waited. */
  private refreshLater(runId: string): void {
    if (this.queued.has(runId)) {
      return;
    }
    this.queued.add(runId);
    this.enqueue(() => {
      this.queued.delete(runId);

      return this.refresh(runId);
    });
  }

  /** One change at a time: an open and a close for the same plan never race. A failed step is logged and the next change gets its own chance. */
  private enqueue(step: () => Promise<void>): void {
    this.work = this.work.then(step).catch((err: unknown) => {
      console.warn(`[plan-presence] ${String(err)}`);
    });
  }

  private async refresh(runId: string): Promise<void> {
    const read = await this.deps.readRun(runId);
    const shown = read ? agentShownOn(read.run, read.visits) : null;

    if (shown) {
      await this.show(runId, shown);
    }
  }

  private async resync(): Promise<void> {
    const open = await this.deps.openPlanningRuns();
    const gone = [...this.shown].filter(
      ([, { runId }]) => !open.includes(runId),
    );

    for (const [planId] of gone) {
      await this.leave(planId);
    }

    for (const runId of open) {
      await this.refresh(runId);
    }
  }

  private async show(
    runId: string,
    { planId, name }: AgentShown,
  ): Promise<void> {
    if (this.shown.get(planId)?.name === name) {
      return;
    }
    await this.leave(planId);

    if (name === null) {
      return;
    }
    await this.deps.writer.openPresence({
      planId,
      user: { name, color: AGENT_COLOR },
    });
    this.shown.set(planId, { runId, name });
  }

  private async leave(planId: string): Promise<void> {
    if (!this.shown.has(planId)) {
      return;
    }
    this.shown.delete(planId);
    await this.deps.writer.closePresence({ planId });
  }
}
