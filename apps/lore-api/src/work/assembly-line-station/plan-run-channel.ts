// A `plan-run` channel (specs/plan-detail-fast-open FR4, ADR-048): which of a plan's planning runs its page follows, that run's facts, then its status and visits from the run's feed, followed across runs as new ones start. No agent event and no ci_check reach it: the plan page draws neither, and the facts carry the spec PR instead.

import type {
  AssemblyRunRecord,
  AssemblyRunsPort,
  AssemblyRunSummary,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { pickPlanRun } from "@re-cinq/lore-shared/feature-planning/pick-plan-run.js";
import type { ChannelHandle } from "./channel-registry.js";
import type { EndReason, FrameSink } from "./frame-sink.js";
import type { LiveTokenVerifier } from "./live-tokens.js";
import { readPlanRunFacts, type PrStatusRead } from "./plan-run-facts.js";
import type { PlanRunListener, PlanRunWatch } from "./plan-run-watch.js";
import type { ClosedReason, OpenMessage } from "./protocol.js";
import type { ChannelOutlet } from "./run-channel.js";
import type { Membership, RunFeedRegistry } from "./run-feed.js";
import type { PlanRunFacts, RunStreamFrame } from "./run-stream-frame.js";

export type PlanRunOpenMessage = Extract<OpenMessage, { kind: "plan-run" }>;

export interface PlanRunChannelDeps {
  verifyToken: LiveTokenVerifier;
  planExists: (planId: string) => Promise<boolean>;
  /** The plan's planning runs, newest first, read with no cost. Throws when a place that holds them can't be read, so an outage never reads as "no run yet". */
  planRuns: (planId: string) => Promise<AssemblyRunSummary[]>;
  runs: Pick<AssemblyRunsPort, "getById">;
  prStatus: PrStatusRead;
  feeds: Pick<RunFeedRegistry, "join">;
  /** Null where no floor is configured: no new run is heard of, and the channel follows the run it opened on. */
  watch: Pick<PlanRunWatch, "follow"> | null;
  /** How long a burst of settling visits is gathered before the facts are read again. */
  refreshMs?: number;
}

/** The page's own refresh of these facts gathered a burst this long. */
export const PLAN_RUN_REFRESH_MS = 300;

const CAPACITY_PREFIX = "run stream: ";

/** What the plan page has no use for: the transcript, and the CI read the facts already carry. */
const UNUSED_FRAMES = new Set<RunStreamFrame["type"]>([
  "agent_event",
  "ci_check",
]);

/** Opens the channel or explains why not: `opened`, a `plan_run`, then the run's frames; or one `closed` naming the refusal. A failed read throws, which the socket reports as a `server` close. */
export async function openPlanRunChannel(
  message: PlanRunOpenMessage,
  outlet: ChannelOutlet,
  deps: PlanRunChannelDeps,
): Promise<ChannelHandle | null> {
  const refusal = await refusalOf(message, deps);

  if (refusal) {
    outlet.send({ type: "closed", channel: message.channel, reason: refusal });

    return null;
  }
  const first = await currentRun(message.subject, deps);
  const channel = new PlanRunChannel(message, outlet, deps);

  outlet.send({ type: "opened", channel: message.channel });

  return channel.start(first) ? channel.handle() : null;
}

async function refusalOf(
  message: PlanRunOpenMessage,
  deps: PlanRunChannelDeps,
): Promise<ClosedReason | null> {
  const viewer = await deps.verifyToken(message.token, {
    kind: "plan-run",
    subject: message.subject,
  });

  if (!viewer) {
    return "unauthorized";
  }

  return (await deps.planExists(message.subject)) ? null : "not_found";
}

interface Followed {
  run: AssemblyRunRecord;
  facts: PlanRunFacts;
}

/** The run the plan's page follows with its facts, or null before any started. */
async function currentRun(
  planId: string,
  deps: PlanRunChannelDeps,
): Promise<Followed | null> {
  const picked = pickPlanRun(await deps.planRuns(planId));

  return picked ? following(picked.id, deps) : null;
}

async function following(
  runId: string,
  deps: PlanRunChannelDeps,
): Promise<Followed | null> {
  const run = await deps.runs.getById(runId);

  return run ? withFacts(run, deps) : null;
}

async function withFacts(
  run: AssemblyRunRecord,
  deps: PlanRunChannelDeps,
): Promise<Followed> {
  return { run, facts: await readPlanRunFacts(run, deps.prStatus) };
}

/** One open channel. Every read runs on one chain, so a switch, a resync and a re-read never interleave and a `plan_run` never overtakes the one before it. */
class PlanRunChannel implements PlanRunListener {
  private followed: Followed | null = null;
  private membership: Membership | null = null;
  /** Bumped on every switch: a frame from a feed the channel has left is dropped. */
  private generation = 0;
  /** The current feed has delivered its snapshot and replay; only a visit settling after that is news. */
  private caughtUp = false;
  private sentFacts = "";
  private chain: Promise<void> = Promise.resolve();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWatching: () => void = () => {};
  private closed = false;

  constructor(
    private readonly message: PlanRunOpenMessage,
    private readonly outlet: ChannelOutlet,
    private readonly deps: PlanRunChannelDeps,
  ) {}

  /** Sends the first `plan_run` and joins its run's feed; false when the feed refused, after telling the client. */
  start(first: Followed | null): boolean {
    if (!this.follow(first)) {
      return false;
    }
    this.stopWatching =
      this.deps.watch?.follow(this.message.subject, this) ?? (() => {});

    return true;
  }

  handle(): ChannelHandle {
    return { receive: () => {}, close: () => this.close() };
  }

  // Asked again once its turn comes: a resync queued before it may already have moved onto this run.
  started(run: AssemblyRunRecord): void {
    const isNew = () => run.id !== this.followed?.run.id;

    if (isNew()) {
      this.enqueue(async () => {
        if (isNew()) {
          this.follow(await withFacts(run, this.deps));
        }
      });
    }
  }

  resync(): void {
    this.enqueue(async () => {
      const current = await currentRun(this.message.subject, this.deps);

      if (current?.run.id !== this.followed?.run.id) {
        this.follow(current);
      }
    });
  }

  lost(): void {
    this.end("server");
  }

  /** Sends the run's facts and moves the channel onto its feed; false, after closing the channel, when the feed refused. */
  private follow(next: Followed | null): boolean {
    if (this.closed) {
      return true;
    }
    this.leaveFeed();
    this.followed = next;
    this.sendFacts(next?.facts ?? null);

    if (!next) {
      return true;
    }
    this.membership = this.joinFeed(next.run);

    if (!this.membership) {
      this.end("capacity");
    }

    return this.membership !== null;
  }

  private joinFeed(run: AssemblyRunRecord): Membership | null {
    try {
      return this.deps.feeds.join(run, this.sink(this.generation), "0");
    } catch (err) {
      if (err instanceof Error && err.message.startsWith(CAPACITY_PREFIX)) {
        return null;
      }
      throw err;
    }
  }

  // A re-read the old run's visits asked for is moot: the switch reads the new run's facts itself.
  private leaveFeed(): void {
    this.generation += 1;
    this.caughtUp = false;
    this.membership?.leave();
    this.membership = null;

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private sink(generation: number): FrameSink {
    const current = () => generation === this.generation && !this.closed;

    return {
      send: (frame) => {
        if (current() && !UNUSED_FRAMES.has(frame.type)) {
          this.forward(frame);
        }
      },
      bufferedBytes: () => this.outlet.bufferedBytes(),
      end: (reason: EndReason) => {
        if (current()) {
          this.end(reason === "slow" ? "slow" : "server");
        }
      },
    };
  }

  private forward(frame: RunStreamFrame): void {
    this.outlet.send({ type: "frame", channel: this.message.channel, frame });

    if (this.caughtUp && changesFacts(frame)) {
      this.scheduleRefresh();
    }
    this.caughtUp ||= frame.type === "catchup_complete";
  }

  /** One re-read per burst of settling visits, as the page's own refresh of these facts did. */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.enqueue(() => this.refresh());
    }, this.deps.refreshMs ?? PLAN_RUN_REFRESH_MS);
  }

  private async refresh(): Promise<void> {
    const runId = this.followed?.run.id;

    if (!runId) {
      return;
    }
    const fresh = await following(runId, this.deps);

    if (fresh && fresh.run.id === this.followed?.run.id) {
      this.followed = fresh;
      this.sendFacts(fresh.facts);
    }
  }

  /** A `plan_run` goes out only when something in it changed. */
  private sendFacts(facts: PlanRunFacts | null): void {
    const encoded = JSON.stringify(facts);

    if (encoded === this.sentFacts) {
      return;
    }
    this.sentFacts = encoded;
    this.outlet.send({
      type: "plan_run",
      channel: this.message.channel,
      run: facts,
    });
  }

  /** A read that fails ends the channel as a server close; the page shows its error and offers to open it again. */
  private enqueue(work: () => Promise<unknown>): void {
    this.chain = this.chain
      .then(async () => {
        if (!this.closed) {
          await work();
        }
      })
      .catch(() => this.end("server"));
  }

  /** The server ends the channel: the client is told, and the socket forgets it. */
  private end(reason: ClosedReason): void {
    if (this.closed) {
      return;
    }
    this.close();
    this.outlet.send({ type: "closed", channel: this.message.channel, reason });
    this.outlet.ended();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stopWatching();
    this.leaveFeed();
  }
}

/** A visit that settled, or the run's own status: the moments the facts (the spec PR, the analysis's question) can change. */
function changesFacts(frame: RunStreamFrame): boolean {
  return (
    frame.type === "run_status" ||
    (frame.type === "node_status" && frame.node.outcome !== null)
  );
}
