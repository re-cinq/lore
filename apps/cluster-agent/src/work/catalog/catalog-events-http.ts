// The catalog-events HTTP transport: fetch the next unapplied batch, and report back the verdicts a batch produced.

import { errorMessage } from "@re-cinq/lore-shared";
import type { CatalogApplyReport } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import type { CatalogSyncTickDeps } from "./catalog-batch-apply.js";
import type {
  CatalogEventsResponse,
  CatalogSyncMode,
  CatalogSyncOutcome,
} from "./catalog-sync-loop.js";

const SYNC_TIMEOUT_MS = 30_000;

/** One poll: fetch the unapplied batch, land every entry, remember the cursor to ack next call. Never throws. Mode `snapshot` forces a full boot resync, repairing a lost or differently-rendered apply (#1727). */
export type FetchOutcome =
  | { kind: "batch"; body: CatalogEventsResponse }
  | { kind: "refused"; outcome: CatalogSyncOutcome };

function catalogEventsQuery(
  ack: string | undefined,
  mode: CatalogSyncMode,
): string {
  const params = new URLSearchParams();

  if (ack !== undefined) {
    params.set("ack", ack);
  }

  if (mode === "snapshot") {
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

// The batch, or a refusal when the body will not parse. A 200 carrying a proxy error page would otherwise throw straight through the loop.
async function readBatchBody(res: Response): Promise<FetchOutcome> {
  try {
    return { kind: "batch", body: (await res.json()) as CatalogEventsResponse };
  } catch (err) {
    return refusedFetch(
      `catalog-events response parse failed: ${errorMessage(err)}`,
    );
  }
}

// Why this batch did not arrive, if it did not. 401/403 is kept distinct from any other failure: it means the per-agent token was rotated elsewhere, and the loop re-registers rather than retrying a credential the API no longer accepts.
function fetchRefusal(res: Response): FetchOutcome | null {
  if (res.status === 401 || res.status === 403) {
    return { kind: "refused", outcome: { kind: "unauthorized" } };
  }

  return res.ok
    ? null
    : refusedFetch(`catalog-events refused (HTTP ${res.status})`);
}

/** Ask for the next batch of catalog events. Every way this can fail — unreachable, unauthorized, refused, unparseable — comes back as an outcome the caller reports without advancing the ack. */
export async function fetchCatalogBatch(
  deps: CatalogSyncTickDeps,
  ack: string | undefined,
  mode: CatalogSyncMode,
): Promise<FetchOutcome> {
  const { id, token } = deps.identity();
  const url = `${deps.apiUrl}/api/cluster-agents/${id}/catalog-events${catalogEventsQuery(ack, mode)}`;
  const res = await requestCatalogEvents(deps.fetchFn, url, token);

  if (isFetchOutcome(res)) {
    return res;
  }

  const refusal = fetchRefusal(res);

  if (refusal) {
    return refusal;
  }

  return readBatchBody(res);
}

// One verdict in the API's own vocabulary — `projectId` becomes `project_id`, and the reason travels with it so a refusal is legible without opening this cluster's logs.
function toWireReport(report: CatalogApplyReport) {
  return {
    name: report.name,
    project_id: report.projectId,
    state: report.state,
    reason: report.reason,
  };
}

/** The status POST itself. A refusal is WARNED, never thrown: a cluster whose verdicts do not land looks stale until the next batch, which is better than a sync loop that stops because reporting failed. */
function postStatus(
  fetchFn: typeof fetch,
  deps: CatalogSyncTickDeps,
  auth: { id: string; token: string },
  reports: CatalogApplyReport[],
): Promise<Response> {
  return fetchFn(
    `${deps.apiUrl}/api/cluster-agents/${auth.id}/catalog-status`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reports: reports.map(toWireReport) }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    },
  );
}

// The verdicts did not land. WARNED, never thrown: this cluster's entries look stale until the next batch, which is better than a sync loop that stops because reporting failed.
function warnStatusUnreported(reason: string): void {
  console.warn(
    `[cluster-agent] catalog status report failed (${reason}) — this cluster's verdicts will look stale until the next batch`,
  );
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
    const res = await postStatus(fetchFn, deps, { id, token }, reports);

    if (!res.ok) {
      warnStatusUnreported(`HTTP ${res.status}`);
    }
  } catch (err) {
    warnStatusUnreported(errorMessage(err));
  }
}
