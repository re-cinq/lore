// How an open `plan-run` channel hears that its plan has a new run (specs/plan-detail-fast-open FR4): every channel shares one viewer of the floor-wide feed the run list already keeps, so the floor holds one socket whatever the number of plan pages. Each run that starts is read once and handed only to the channels watching its plan.

import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { floorPlanSubject } from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import type {
  FloorRunsFeed,
  RunsMembership,
  RunsViewer,
} from "../floor/floor-runs-feed.js";
import type { RunListFrame } from "./protocol.js";

/** The floor keys a planning run `plan_id:<plan id>`. */
const PLAN_SUBJECT_PREFIX = floorPlanSubject("");

export interface PlanRunListener {
  /** A run of this plan started. */
  started(run: AssemblyRunRecord): void;
  /** The floor's feed had a gap: a run may have started unseen, so the plan's runs are worth asking for again. */
  resync(): void;
  /** The floor's feed ended; no further start will be heard. */
  lost(): void;
}

export interface PlanRunWatchDeps {
  feed: Pick<FloorRunsFeed, "join">;
  runs: Pick<AssemblyRunsPort, "getById">;
  log?: (message: string) => void;
}

export class PlanRunWatch {
  private readonly listeners = new Map<string, Set<PlanRunListener>>();
  private membership: RunsMembership | null = null;

  constructor(private readonly deps: PlanRunWatchDeps) {}

  /** Tells the listener of each run of the plan that starts until the returned stop is called. */
  follow(planId: string, listener: PlanRunListener): () => void {
    const planListeners = this.listeners.get(planId) ?? new Set();

    planListeners.add(listener);
    this.listeners.set(planId, planListeners);
    this.membership ??= this.deps.feed.join(this.viewer());

    return () => this.unfollow(planId, listener);
  }

  get planCount(): number {
    return this.listeners.size;
  }

  private unfollow(planId: string, listener: PlanRunListener): void {
    const planListeners = this.listeners.get(planId);

    planListeners?.delete(listener);

    if (planListeners?.size === 0) {
      this.listeners.delete(planId);
    }

    if (this.listeners.size === 0) {
      this.membership?.leave();
      this.membership = null;
    }
  }

  private viewer(): RunsViewer {
    return {
      send: (frame) => this.heard(frame),
      end: () => this.ended(),
    };
  }

  private heard(frame: RunListFrame): void {
    if (frame.type === "run_started") {
      void this.readStarted(frame.run_id);

      return;
    }

    if (frame.type === "resync") {
      this.everyListener().forEach((listener) => listener.resync());
    }
  }

  /** One read per started run, however many channels are open; a run of no watched plan reaches nobody. A run that can't be read may be any plan's, so every channel asks for its plan's runs again. */
  private async readStarted(runId: string): Promise<void> {
    let run: AssemblyRunRecord | null;

    try {
      run = await this.deps.runs.getById(runId);
    } catch (err) {
      this.log(`started run ${runId} unreadable: ${String(err)}`);
      this.everyListener().forEach((listener) => listener.resync());

      return;
    }

    if (run) {
      const started = run;

      this.listenersOf(started).forEach((listener) =>
        listener.started(started),
      );
    }
  }

  private listenersOf(run: AssemblyRunRecord): PlanRunListener[] {
    const subject = run.subjectKey ?? "";

    if (!subject.startsWith(PLAN_SUBJECT_PREFIX)) {
      return [];
    }

    return [
      ...(this.listeners.get(subject.slice(PLAN_SUBJECT_PREFIX.length)) ?? []),
    ];
  }

  /** The feed dropped this viewer: every channel is told, and the next channel to open joins afresh. */
  private ended(): void {
    const stranded = this.everyListener();

    this.membership = null;
    this.listeners.clear();
    stranded.forEach((listener) => listener.lost());
  }

  private everyListener(): PlanRunListener[] {
    return [...this.listeners.values()].flatMap((set) => [...set]);
  }

  private log(message: string): void {
    (this.deps.log ?? console.warn)(`[plan-run] ${message}`);
  }
}
