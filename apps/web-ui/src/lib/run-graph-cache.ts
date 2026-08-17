// Whether the wizard may keep a run's graph across poll ticks, and how to fold an
// omitted one back in (#1238).
//
// Its own module because the CLIENT needs it: `feature-run.ts` reaches the API and
// is server-only, so importing these from there drags `server-only` into a browser
// bundle. They are pure — no IO, no React — so both sides can share them.

import type { FeatureRunPayload } from "./feature-run";

/**
 * Whether a client may keep this run's graph across poll ticks.
 *
 * A real run carries a CLONE of its blueprint, stamped once at start and never
 * edited (specs/6-dark-factory FR6.38) — so re-sending it every 4s for the life of
 * a planning round is pure waste. A SYNTHETIC graph is the opposite: it is
 * inferred from the visit rows and grows a node each time one lands, so it must be
 * re-sent every tick or the picture stops matching the run.
 */
export function graphIsCacheable(run: FeatureRunPayload): boolean {
  return !run.synthetic && run.definition !== null;
}

/**
 * Fold a freshly polled run into the one the client already had, restoring the
 * graph the server chose to omit.
 *
 * Keyed on the run ID, not merely on the omission: a retry mints a NEW run with
 * its own clone, and carrying the previous run's graph over would draw the wrong
 * picture confidently. The request names the run whose graph the client holds, so
 * a mismatch here means the server answered about a different one — in which case
 * the honest result is no graph rather than a stale one.
 */
export function mergeRunGraph(
  previous: FeatureRunPayload | null,
  next: FeatureRunPayload,
): FeatureRunPayload {
  if (!next.definitionUnchanged || next.definition !== null) {
    return next;
  }

  return previous && previous.id === next.id
    ? {
        ...next,
        definition: previous.definition,
        synthetic: previous.synthetic,
      }
    : next;
}
