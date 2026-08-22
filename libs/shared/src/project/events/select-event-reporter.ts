// Where a producer reports its events.
//
// The same three-way shape `agentDefs` uses (`PgAgentDefs` / `AgentDefsHttp` /
// `AgentDefsYaml`, selected on the environment in `project-factory`): the
// event-router owns `pipeline.events` (ADR-044), so a producer that can see the
// router reports over HTTP, and one that cannot falls back to the pool it
// already holds.
//
// The fallback is for LOCAL DEVELOPMENT, where `npm start` brings up a Floor and
// a Postgres but no router. It is NOT a silent degradation in a cluster: a
// deployment that means to route and has lost `EVENT_ROUTER_URL` would write
// directly and look healthy, so the choice is logged once at construction.

import { HttpEventReporter } from "./event-reporter-http.js";
import type { EventReporter } from "./event-queue-port.js";

export interface SelectReporterDeps {
  /**
   * The pool-backed reporter to fall back to — normally `pipeline().eventQueue`.
   *
   * A THUNK, not a value: resolving it usually means resolving a pool, and a
   * process that reports to the router has no reason to hold one. Passing the
   * value eagerly is what made lore-api demand a database in tests that had
   * deliberately injected their own.
   */
  local: () => EventReporter;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/**
 * Resolve the reporter for this process. Call once, at a composition root, and
 * memoize there — the log line is meant to appear once per boot, not per event.
 */
export function selectEventReporter(deps: SelectReporterDeps): EventReporter {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const url = env.EVENT_ROUTER_URL;

  if (!url) {
    log(
      "[events] EVENT_ROUTER_URL unset — reporting directly to pipeline.events (local mode)",
    );

    return deps.local();
  }
  log(`[events] reporting to the event-router at ${url}`);

  return new HttpEventReporter(url, env.LORE_INGEST_TOKEN);
}
