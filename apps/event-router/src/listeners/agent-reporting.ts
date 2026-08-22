// What the watch DOES with a CR, separated from the connection that delivers it.
//
// The reconnect loop and the live `Watch` next door cannot be unit-tested
// without a cluster; these two can, against a plain object and a fake lister —
// so they live apart from the shell rather than being excluded from coverage
// along with it.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import type { EventInsert } from "@re-cinq/lore-shared";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import type { CustomObjectsApi } from "@kubernetes/client-node";

export const GROUP = "agents.re-cinq.com";
export const VERSION = "v1alpha1";
export const PLURAL = "agents";
const LIST_PAGE_LIMIT = 50;

export interface WatchDeps {
  insert: (event: EventInsert) => Promise<void>;
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
  let continueToken: string | undefined;
  let resourceVersion: string | undefined;

  do {
    const page = (await k8sApi.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
      limit: LIST_PAGE_LIMIT,
      _continue: continueToken,
    })) as AgentListPage;

    await onPage(page.items ?? []);
    continueToken = page.metadata?._continue ?? page.metadata?.continue;
    resourceVersion = page.metadata?.resourceVersion ?? resourceVersion;
  } while (continueToken);

  return resourceVersion;
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
  await deps
    .insert(ev)
    .catch((err) =>
      console.error(
        "[event-router] k8s report failed:",
        (err as Error).message,
      ),
    );
}
