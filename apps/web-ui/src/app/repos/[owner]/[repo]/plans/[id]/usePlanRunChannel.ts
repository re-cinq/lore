"use client";

// The plan's current planning run, read over its `plan-run` channel of the tab's live socket (specs/plan-detail-fast-open FR5, FR9): unknown until the first `plan_run` message, then the run (or none), with its status and visits folded in as they arrive. The server render reads no run at all.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { LiveSocketClient } from "@/lib/live-socket/client";
import type { ChannelState } from "@/lib/live-socket/connection-machine";
import { useLiveSocket } from "@/lib/live-socket/LiveSocketProvider";
import type { PlanRunFacts } from "@/lib/live-socket/protocol";
import {
  initialPlanRunLive,
  reducePlanRunLive,
  type PlanRunLiveState,
} from "@/lib/plan-run-live-reducer";
import type { RunStreamFrame } from "@/lib/run-stream-types";
import type { PlanRun } from "./PlanRunCard";

/** How long the page waits for the channel's first `plan_run` before it says the run could not be loaded. */
export const PLAN_RUN_DEADLINE_MS = 15_000;

export type PlanRunState = "unknown" | "known" | "failed";

export interface PlanRunChannel {
  state: PlanRunState;
  /** Null while unknown or failed, and once known when no run has started. */
  run: PlanRun | null;
  /** Opens the channel again after a failure. */
  retry: () => void;
}

type MintToken = () => Promise<{ token: string } | { error: string }>;

type Facts = Omit<PlanRun, "nodes">;

interface ChannelFold {
  state: PlanRunState;
  facts: Facts | null;
  live: PlanRunLiveState;
}

type FoldAction =
  | { type: "plan_run"; run: PlanRunFacts }
  | { type: "frame"; frame: RunStreamFrame }
  | { type: "failed" }
  | { type: "reopened" };

const UNKNOWN: ChannelFold = {
  state: "unknown",
  facts: null,
  live: initialPlanRunLive(
    { status: "queued", outcome: null, reason: null },
    [],
  ),
};

/** Follows the plan's run on its own channel. `token` opens the first channel; every later open (a reconnect, a refused token, Retry) asks `mintToken` for a fresh one. */
export function usePlanRunChannel(
  planId: string,
  token: string | null,
  mintToken: MintToken,
): PlanRunChannel {
  const client = useLiveSocket();
  const [fold, dispatch] = useReducer(reduceChannel, UNKNOWN);
  const [attempt, setAttempt] = useState(0);
  const tokens = useTokenSource(token, mintToken);

  useEffect(
    () => followPlanRun({ planId, client, tokens, dispatch }),
    [planId, client, tokens, attempt],
  );
  const retry = useCallback(() => {
    dispatch({ type: "reopened" });
    setAttempt((count) => count + 1);
  }, []);

  return { state: fold.state, run: runOf(fold), retry };
}

interface Follow {
  planId: string;
  client: LiveSocketClient | null;
  tokens: { current: () => Promise<string> };
  dispatch: (action: FoldAction) => void;
}

/** One attempt on the channel; returns its teardown. Without a socket there is nothing to open, and the run can never be known. */
function followPlanRun(follow: Follow) {
  if (follow.client === null) {
    follow.dispatch({ type: "failed" });

    return undefined;
  }
  const attempt = new PlanRunAttempt(follow.client, follow);

  attempt.start();

  return () => attempt.stop();
}

/** Opens the channel, reopens it once if the server ends it before the run is known (a token it refused), and gives up at the deadline. Once the run is known, a channel that ends keeps the run it showed. */
class PlanRunAttempt {
  private known = false;
  private reopened = false;
  private handle = { close: () => {} };
  private deadline: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly client: LiveSocketClient,
    private readonly follow: Omit<Follow, "client">,
  ) {}

  start(): void {
    this.deadline = setTimeout(() => this.fail(), PLAN_RUN_DEADLINE_MS);
    this.handle = this.open();
  }

  stop(): void {
    clearTimeout(this.deadline);
    this.handle.close();
  }

  private open() {
    const { planId, tokens, dispatch } = this.follow;

    return this.client.open({
      kind: "plan-run",
      subject: planId,
      token: () => tokens.current(),
      onPlanRun: (run) => this.heard(run),
      onFrame: (frame) => dispatch({ type: "frame", frame }),
      onState: (state: ChannelState) => state === "offline" && this.ended(),
    });
  }

  private heard(run: PlanRunFacts): void {
    this.known = true;
    clearTimeout(this.deadline);
    this.follow.dispatch({ type: "plan_run", run });
  }

  private ended(): void {
    if (this.known || this.reopened) {
      this.fail();

      return;
    }
    this.reopened = true;
    queueMicrotask(() => {
      this.handle.close();
      this.handle = this.open();
    });
  }

  private fail(): void {
    if (!this.known) {
      this.follow.dispatch({ type: "failed" });
    }
  }
}

/** The page's token for the first open, then a fresh one from `mintToken` for every open after it. A refused mint throws, which the socket client reads as a failed open and retries after a pause. */
function useTokenSource(token: string | null, mintToken: MintToken) {
  const unused = useRef(token);
  const latestMint = useRef(mintToken);
  const source = useRef(async () => {
    const first = unused.current;

    unused.current = null;

    return first ?? mintedToken(latestMint.current);
  });

  useEffect(() => {
    latestMint.current = mintToken;
  });

  return source;
}

async function mintedToken(mintToken: MintToken): Promise<string> {
  const minted = await mintToken();

  if ("error" in minted) {
    throw new Error(minted.error);
  }

  return minted.token;
}

const FOLDS: {
  [A in FoldAction as A["type"]]: (fold: ChannelFold, action: A) => ChannelFold;
} = {
  plan_run: (fold, action) => withFacts(fold, action.run),
  frame: (fold, action) => ({
    ...fold,
    live: reducePlanRunLive(fold.live, action.frame),
  }),
  failed: (fold) =>
    fold.state === "unknown" ? { ...UNKNOWN, state: "failed" } : fold,
  reopened: () => UNKNOWN,
};

function reduceChannel(fold: ChannelFold, action: FoldAction): ChannelFold {
  const apply = FOLDS[action.type] as (
    fold: ChannelFold,
    action: FoldAction,
  ) => ChannelFold;

  return apply(fold, action);
}

/** A `plan_run` replaces the run's facts; its visits are kept only while it is the same run. */
function withFacts(fold: ChannelFold, run: PlanRunFacts): ChannelFold {
  if (!run) {
    return { state: "known", facts: null, live: UNKNOWN.live };
  }
  const facts = factsOf(run);
  const sameRun = fold.facts?.id === facts.id;

  return {
    state: "known",
    facts,
    live: initialPlanRunLive(facts, sameRun ? fold.live.nodes : []),
  };
}

function runOf(fold: ChannelFold): PlanRun | null {
  return (
    fold.facts && { ...fold.facts, ...fold.live.run, nodes: fold.live.nodes }
  );
}

function factsOf(run: NonNullable<PlanRunFacts>): Facts {
  return {
    id: run.id,
    status: run.status,
    outcome: run.outcome,
    reason: run.reason,
    issueUrl: run.issue_url,
    issueNumber: run.issue_number,
    prUrl: run.pr_url,
    prNumber: run.pr_number,
    prTitle: run.pr_title,
    prUnresolvedThreads: run.pr_unresolved_threads,
    specPlanSummary: run.spec_plan_summary,
  };
}
