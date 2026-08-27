// What the watch DOES with a CR, separated from the connection that delivers it.
//
// The reconnect loop and the live `Watch` next door cannot be unit-tested
// without a cluster; these two can, against a plain object and a fake lister —
// so they live apart from the shell rather than being excluded from coverage
// along with it.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import type { EventInsert } from "@re-cinq/lore-shared";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import { STATION_RUN_ID_LABEL } from "@re-cinq/lore-shared/project/events/agent-cr-labels.js";
import { forEachPage } from "@re-cinq/lore-shared/lib/paginate.js";
import type { CustomObjectsApi } from "@kubernetes/client-node";

export const GROUP = "agents.re-cinq.com";
export const VERSION = "v1alpha1";
export const PLURAL = "agents";
const LIST_PAGE_LIMIT = 50;

export interface WatchDeps {
  insert: (event: EventInsert) => Promise<void>;
  /** Report what the visit printed, keyed by its station run id. Optional so a
   *  composition without the Lore API (tests, the pre-cutover central agent)
   *  still reports events. */
  reportOutput?: (stationRunId: string, output: string) => Promise<void>;
  /** How hard to retry a report. Omitted, one attempt — the shape a test wants. */
  retry?: ReportRetry;
}

/** Bounded retry for one report. */
export interface ReportRetry {
  attempts: number;
  delayMs: number;
}

/** The slice of CustomObjectsApi the paginated list needs; tests fake this. */
export type AgentLister = Pick<CustomObjectsApi, "listNamespacedCustomObject">;

interface AgentListPage {
  items?: AgentCr[];
  // The wire field is `continue`; custom-object responses are raw JSON, but the
  // client's model mapper would surface `_continue` — read whichever is present.
  metadata?: {
    continue?: string;
    _continue?: string;
    resourceVersion?: string;
  };
}

/**
 * Walk the Agent CRs one page at a time, returning the list's resourceVersion.
 * Never holds (or JSON.parses) the whole namespace at once: 180 accumulated CRs
 * (~1.4MB of status each) in a single unpaginated LIST blew Node's heap and
 * crash-looped the Floor on 2026-07-24.
 */
export async function forEachAgentPage(
  k8sApi: AgentLister,
  namespace: string,
  onPage: (items: AgentCr[]) => Promise<void>,
): Promise<string | undefined> {
  let resourceVersion: string | undefined;

  await forEachPage<AgentCr>(async (continueToken?: string) => {
    const page = (await k8sApi.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
      limit: LIST_PAGE_LIMIT,
      _continue: continueToken,
    })) as AgentListPage;

    // Captured here rather than returned by the walk: the resourceVersion is
    // this caller's concern (it seeds the watch), not pagination's.
    resourceVersion = page.metadata?.resourceVersion ?? resourceVersion;

    return {
      items: page.items ?? [],
      continueToken: page.metadata?._continue ?? page.metadata?.continue,
    };
  }, onPage);

  return resourceVersion;
}

/**
 * Send the CR's output ahead of the event that will make somebody read it.
 *
 * ORDER, not politeness: the event is the trigger and the output is what the
 * trigger sends a reader looking for, so an event that overtakes its own payload
 * is read as a node that produced nothing — the exact misreading this whole path
 * exists to end. A failure here is logged and swallowed rather than cancelling
 * the event: a reported terminal phase with no output leaves the visit open for
 * the reaper, which is recoverable, while no event at all is a line that parks
 * until its budget expires.
 */
async function reportOutputFor(agent: AgentCr, deps: WatchDeps): Promise<void> {
  const stationRunId = agent.metadata?.labels?.[STATION_RUN_ID_LABEL];
  const output = agent.status?.output;

  if (!deps.reportOutput || !stationRunId || !output) {
    return;
  }

  try {
    await deps.reportOutput(stationRunId, output);
  } catch (err) {
    console.error(
      `[cluster-agent] terminal output report failed for ${stationRunId}:`,
      (err as Error).message,
    );
  }
}

/**
 * Map one observed CR and report it, if it is terminal.
 *
 * A failed report is logged and swallowed HERE, unlike everywhere else this
 * repo reports events. The caller is a watch callback with nobody to return a
 * status to: throwing would take down the stream over one CR, and the Floor's
 * reconcile pass re-emits anything missed.
 */
export async function reportForAgent(
  agent: AgentCr,
  deps: WatchDeps,
): Promise<void> {
  const ev = mapAgentToEvent(agent as never);

  if (!ev) {
    return;
  }
  await reportOutputFor(agent, deps);
  const { attempts, delayMs } = deps.retry ?? { attempts: 1, delayMs: 0 };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await deps.insert(ev);

      return;
    } catch (err) {
      // Retried, not swallowed on the first try: this insert used to be a write
      // on this process's own pool and is now a POST to the event-router, so a
      // blip is ordinary. Safe to repeat — every event mapAgentToEvent produces
      // carries a dedupeKey, so a duplicate reaching the router is a no-op.
      if (attempt === attempts) {
        // Never thrown: the watch loop must survive one bad report. The event is
        // lost at this point, and the Floor's reconcile cron is what still
        // catches it — which is why that backstop stays off this process.
        console.error(
          `[cluster-agent] k8s report failed after ${attempts} attempts:`,
          (err as Error).message,
        );

        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
