// What the watch DOES with a CR, separated from the connection that delivers it — testable against a plain object and a fake lister, unlike the reconnect loop and live Watch beside it.

import { errorMessage } from "@re-cinq/lore-shared";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import type { Emit } from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { forEachPage } from "@re-cinq/lore-shared/lib/paginate.js";
import type { CustomObjectsApi } from "@kubernetes/client-node";
import { GROUP, VERSION, AGENT_PLURAL as PLURAL } from "../kernel/crd.js";

// Re-exported so k8s-watch.ts reads the CRD identity through this module rather than a second import.
export { GROUP, VERSION, PLURAL };

const LIST_PAGE_LIMIT = 50;

export interface WatchDeps {
  /** Hand the event to the proxy — resolves once QUEUED, blocking while full (the only backpressure the watch has). */
  emit: Emit;
}

/** The slice of CustomObjectsApi the paginated list needs; tests fake this. */
export type AgentLister = Pick<CustomObjectsApi, "listNamespacedCustomObject">;

interface AgentListPage {
  items?: AgentCr[];
  // The wire field is `continue`; the model mapper would surface `_continue` instead — read whichever is present.
  metadata?: {
    continue?: string;
    _continue?: string;
    resourceVersion?: string;
  };
}

function pageResourceVersion(
  page: AgentListPage,
  previous: string | undefined,
): string | undefined {
  return page.metadata?.resourceVersion ?? previous;
}

// The wire field is `continue`; the model mapper would surface `_continue` instead — read whichever is present.
function pageContinueToken(page: AgentListPage): string | undefined {
  return page.metadata?._continue ?? page.metadata?.continue;
}

/** Walk the Agent CRs one page at a time, returning the list's resourceVersion — 180 accumulated CRs in one unpaginated LIST blew Node's heap on 2026-07-24. */
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

    // Captured here rather than returned by the walk — the resourceVersion is this caller's concern (it seeds the watch), not pagination's.
    resourceVersion = pageResourceVersion(page, resourceVersion);

    return {
      items: page.items ?? [],
      continueToken: pageContinueToken(page),
    };
  }, onPage);

  return resourceVersion;
}

/** Map one observed CR and hand it to the proxy if terminal. A failed emit is logged and swallowed HERE — the caller is a watch callback with nobody to return a status to. */
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
      errorMessage(err),
    );
  }
}
