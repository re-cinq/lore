// The catalog-events HTTP transport: fetch the next unapplied batch, and report back the verdicts a batch produced.

import { errorMessage } from "@re-cinq/lore-shared";
import type { CatalogApplyReport } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import type { CatalogSyncTickDeps } from "./catalog-batch-apply.js";
import type {
  CatalogEventsResponse,
  CatalogSyncOutcome,
} from "./catalog-sync-loop.js";

const SYNC_TIMEOUT_MS = 30_000;

/** One poll: fetch the unapplied batch, land every entry, remember the cursor to ack next call. Never throws. `snapshot` forces a full boot resync, repairing a lost or differently-rendered apply (#1727). */
export type FetchOutcome =
  | { kind: "batch"; body: CatalogEventsResponse }
  | { kind: "refused"; outcome: CatalogSyncOutcome };

function catalogEventsQuery(
  ack: string | undefined,
  snapshot: boolean,
): string {
  const params = new URLSearchParams();

  if (ack !== undefined) {
    params.set("ack", ack);
  }

  if (snapshot) {
    params.set("snapshot", "1");
  }

  return params.size > 0 ? `?${params.toString()}` : "";
}

function refusedFetch(message: string): FetchOutcome {
  return { kind: "refused", outcome: { kind: "error", message } };
}

async function requestCatalogEvents(
  fetchFn: typeof fetch | undefined,
  url: string,
  token: string,
): Promise<Response | FetchOutcome> {
  try {
    return await (fetchFn ?? fetch)(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
  } catch (err) {
    return refusedFetch(`catalog-events fetch failed: ${errorMessage(err)}`);
  }
}

function isFetchOutcome(value: Response | FetchOutcome): value is FetchOutcome {
  return "kind" in value;
}

/** Ask for the next batch of catalog events. Every way this can fail — unreachable, unauthorized, refused, unparseable — comes back as an outcome the caller reports without advancing the ack. */
export async function fetchCatalogBatch(
  deps: CatalogSyncTickDeps,
  ack: string | undefined,
  snapshot: boolean,
): Promise<FetchOutcome> {
  const { id, token } = deps.identity();
  const url = `${deps.apiUrl}/api/cluster-agents/${id}/catalog-events${catalogEventsQuery(ack, snapshot)}`;
  const res = await requestCatalogEvents(deps.fetchFn, url, token);

  if (isFetchOutcome(res)) {
    return res;
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "refused", outcome: { kind: "unauthorized" } };
  }

  if (!res.ok) {
    return refusedFetch(`catalog-events refused (HTTP ${res.status})`);
  }

  try {
    return { kind: "batch", body: (await res.json()) as CatalogEventsResponse };
  } catch (err) {
    return refusedFetch(
      `catalog-events response parse failed: ${errorMessage(err)}`,
    );
  }
}

/** POST the batch's verdicts. Never throws: visibility must not cost delivery. */
export async function reportStatus(
  deps: CatalogSyncTickDeps,
  reports: CatalogApplyReport[],
): Promise<void> {
  if (reports.length === 0) {
    return;
  }
  const fetchFn = deps.fetchFn ?? fetch;
  const { id, token } = deps.identity();

  try {
    const res = await fetchFn(
      `${deps.apiUrl}/api/cluster-agents/${id}/catalog-status`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reports: reports.map((r) => ({
            name: r.name,
            project_id: r.projectId,
            state: r.state,
            reason: r.reason,
          })),
        }),
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      console.warn(
        `[cluster-agent] catalog status report refused (HTTP ${res.status}) — this cluster's verdicts will look stale until the next batch`,
      );
    }
  } catch (err) {
    console.warn(
      `[cluster-agent] catalog status report failed: ${errorMessage(err)}`,
    );
  }
}
