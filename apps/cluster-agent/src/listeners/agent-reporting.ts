// What the watch DOES with a CR, separated from the connection that delivers it.
//
// The reconnect loop and the live `Watch` next door cannot be unit-tested
// without a cluster; these two can, against a plain object and a fake lister —
// so they live apart from the shell rather than being excluded from coverage
// along with it.
//
// This file used to carry a retry ladder and a re-registration hook as well.
// Both moved to the shared `EventProxy`: every producer that reports to the
// router needs that ladder and exactly one of them had it. What is left is the
// mapping — observe a CR, hand the event over — which is all an input should
// decide.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import type { Emit } from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { forEachPage } from "@re-cinq/lore-shared/lib/paginate.js";
import type { CustomObjectsApi } from "@kubernetes/client-node";

export const GROUP = "agents.re-cinq.com";
export const VERSION = "v1alpha1";
export const PLURAL = "agents";
const LIST_PAGE_LIMIT = 50;

export interface WatchDeps {
  /** Hand the event to the proxy. Resolves once QUEUED, and blocks while the
   *  queue is full — which is the only backpressure the watch has. */
  emit: Emit;
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
 * Map one observed CR and hand it to the proxy, if it is terminal.
 *
 * A failed emit is logged and swallowed HERE, unlike everywhere else this repo
 * reports events. The caller is a watch callback with nobody to return a status
 * to: throwing would take down the stream over one CR. Delivery failure is no
 * longer among the things that can happen here — `emit` only queues — so this
 * guards a defect rather than a blip, and the Floor's reconcile pass re-emits
 * anything missed either way.
 */
export async function reportForAgent(
  agent: AgentCr,
  deps: WatchDeps,
): Promise<void> {
  const ev = mapAgentToEvent(agent as never);

  if (!ev) {
    return;
  }

  try {
    await deps.emit({ kind: "event", event: ev });
  } catch (err) {
    console.error(
      `[cluster-agent] could not queue the report for ${agent.metadata?.name}:`,
      (err as Error).message,
    );
  }
}
