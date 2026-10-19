// An analyze pass has ended: the section a person asked about is marked answered, or told why it was not, and the ask is cleared either way (specs/7-feature-planning FR-18).

import type { RefineAsk, RefineAsks } from "./refine-asks.js";

export interface RefineSettlePorts {
  refineAsks: Pick<RefineAsks, "pending" | "clear">;
  writer: {
    finishRefine(request: {
      planId: string;
      slot: string;
      uses: unknown;
    }): Promise<unknown>;
    failRefine(request: {
      planId: string;
      slot: string;
      reason: string;
    }): Promise<unknown>;
  };
}

/** How the pass ended, as the floor reported its outcome. */
export interface PassEnd {
  outcome: string;
  reason?: string;
}

export interface RefineSettled {
  settled: boolean;
  slot?: string;
}

const STOPPED = "the planning agent stopped before it answered";

/** A pass nobody asked about settles nothing: it was a first draft. */
export async function settleRefine(
  planId: string,
  pass: PassEnd,
  ports: RefineSettlePorts,
): Promise<RefineSettled> {
  const ask = await ports.refineAsks.pending(planId);

  if (!ask) {
    return { settled: false };
  }
  await answer(ask, pass, ports);
  // Cleared even when the pass stopped: a second Refine must not read the first's failure as its own.
  await ports.refineAsks.clear(planId);

  return { settled: true, slot: ask.slot };
}

function answer(
  ask: RefineAsk,
  pass: PassEnd,
  ports: RefineSettlePorts,
): Promise<unknown> {
  const { planId, slot } = ask;

  return pass.outcome === "success"
    ? ports.writer.finishRefine({ planId, slot, uses: ask.uses })
    : ports.writer.failRefine({
        planId,
        slot,
        reason: pass.reason ?? STOPPED,
      });
}
