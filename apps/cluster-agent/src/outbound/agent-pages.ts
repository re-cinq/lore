// Paging the Agent CR list API. Here rather than beside the watch because it drives Kubernetes — and because pod-log collection in `work` needs it too, which made the listener an upward import.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { forEachPage } from "@re-cinq/lore-shared/lib/paginate.js";
import type { CustomObjectsApi } from "@kubernetes/client-node";
import { GROUP, VERSION, AGENT_PLURAL as PLURAL } from "../domain/crd.js";

const LIST_PAGE_LIMIT = 50;

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
