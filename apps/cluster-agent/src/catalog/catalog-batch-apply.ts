// Per-entry catalog apply: ownership checks, one entry's verdict, and tallying a batch of verdicts.

import { errorMessage } from "@re-cinq/lore-shared";
import {
  agentDefToCrds,
  catalogCrdName,
  SYNC_MANAGED_BY,
  UI_MANAGED_BY,
  validateCatalogEntry,
  type CatalogCrdOptions,
} from "@re-cinq/lore-shared/project/agents/agent-crd.js";
import { isPermanentApplyError } from "../kernel/k8s-errors.js";
import type { CatalogApplyReport } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import type { ClusterAgentIdentity } from "../claim/identity-store.js";
import type { CatalogEventsResponse } from "./catalog-sync-loop.js";

/** The three catalog operations a sync needs: applyPair/deletePair plus the read the seed-ownership guard makes. */
export interface CatalogTarget {
  applyPair(pair: {
    agentDefinition: AgentDefinition;
    station: Station;
  }): Promise<void>;
  deletePair(name: string): Promise<void>;
  getAgentDefinition(name: string): Promise<AgentDefinition | null>;
}

type CrdOwnership =
  { writable: true } | { writable: false; managedBy: string | undefined };

function managedByLabelOf(live: AgentDefinition): string | undefined {
  return live.metadata?.labels?.["app.kubernetes.io/managed-by"];
}

/** A live CR labeled by neither the sync loop nor the UI belongs to someone else. */
async function checkCrdOwnership(
  catalog: CatalogTarget,
  crdName: string,
): Promise<CrdOwnership> {
  const live = await catalog.getAgentDefinition(crdName);

  if (live === null) {
    return { writable: true };
  }
  const managedBy = managedByLabelOf(live);

  if (managedBy === SYNC_MANAGED_BY || managedBy === UI_MANAGED_BY) {
    return { writable: true };
  }

  return { writable: false, managedBy };
}

export interface CatalogSyncTickDeps {
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  catalog: CatalogTarget;
  crdOptions: CatalogCrdOptions;
  // Transition guard: skips seed-labeled CRs until LORE_CATALOG_SYNC_OWN_SEEDED=1 at cutover, else two writers would flap.
  ownSeeded: boolean;
  fetchFn?: typeof fetch;
}

/** What one entry did. `transient` is the only verdict that stops the batch: the ack stays put so the whole batch re-serves. */
type EntryVerdict =
  | { state: "applied" | "deleted" }
  | { state: "skipped" | "refused"; detail: string; reason: string }
  | { state: "transient"; message: string };

// Ownership check FIRST, for deletes too — a null-definition event must never remove a seed-owned or hand-applied CR.
async function resolveCrdOwnership(
  deps: CatalogSyncTickDeps,
  crdName: string,
): Promise<CrdOwnership> {
  return deps.ownSeeded
    ? { writable: true as const }
    : checkCrdOwnership(deps.catalog, crdName);
}

function skippedVerdict(
  crdName: string,
  managedBy: string | undefined,
): EntryVerdict {
  const owner = managedBy ?? "an unlabeled writer";

  return {
    state: "skipped",
    detail: `${crdName} (${managedBy ?? "unlabeled"})`,
    reason: `owned by ${owner}`,
  };
}

// A 400/422 can never succeed, so it refuses; anything else is transient and keeps the ack so the batch re-serves.
function classifyApplyError(err: unknown, crdName: string): EntryVerdict {
  if (isPermanentApplyError(err)) {
    const reason = `${errorMessage(err)} (pair may be half-applied — Station half lands first)`;

    return { state: "refused", detail: `${crdName}: ${reason}`, reason };
  }

  return {
    state: "transient",
    message: `catalog entry ${crdName} failed to land: ${errorMessage(err)}`,
  };
}

/** Land one catalog entry as a CRD pair. */
async function applyCatalogEntry(
  deps: CatalogSyncTickDeps,
  entry: CatalogEventsResponse["entries"][number],
  crdName: string,
): Promise<EntryVerdict> {
  try {
    const ownership = await resolveCrdOwnership(deps, crdName);

    if (!ownership.writable) {
      return skippedVerdict(crdName, ownership.managedBy);
    }

    if (entry.definition === null) {
      await deps.catalog.deletePair(crdName);

      return { state: "deleted" };
    }
    // Refusal is permanent for this (row, cluster) pair, so the loop acks past it — re-serving head-of-line blocked the tail for 2h on 2026-09-01.
    const refusal = validateCatalogEntry(entry.definition, deps.crdOptions);

    if (refusal !== null) {
      return {
        state: "refused",
        detail: `${crdName}: ${refusal}`,
        reason: refusal,
      };
    }
    await deps.catalog.applyPair(
      agentDefToCrds(entry.definition, deps.crdOptions),
    );

    return { state: "applied" };
  } catch (err) {
    return classifyApplyError(err, crdName);
  }
}

export interface BatchTally {
  applied: number;
  deleted: number;
  skipped: string[];
  refused: string[];
  // Structured verdicts for the status report — a log line dies with the pod (2026-09-01).
  reports: CatalogApplyReport[];
}

export type BatchApplyResult =
  { kind: "ok"; tally: BatchTally } | { kind: "transient"; message: string };

function recordVerdict(
  tally: BatchTally,
  entry: CatalogEventsResponse["entries"][number],
  verdict: Exclude<EntryVerdict, { state: "transient" }>,
): void {
  if (verdict.state === "applied") {
    tally.applied += 1;
  }

  if (verdict.state === "deleted") {
    tally.deleted += 1;
  }

  if (verdict.state === "skipped") {
    tally.skipped.push(verdict.detail);
  }

  if (verdict.state === "refused") {
    tally.refused.push(verdict.detail);
  }
  tally.reports.push({
    name: entry.name,
    projectId: entry.project_id,
    state: verdict.state,
    reason: "reason" in verdict ? verdict.reason : null,
  });
}

export async function applyBatchEntries(
  deps: CatalogSyncTickDeps,
  entries: CatalogEventsResponse["entries"],
): Promise<BatchApplyResult> {
  const tally: BatchTally = {
    applied: 0,
    deleted: 0,
    skipped: [],
    refused: [],
    reports: [],
  };

  for (const entry of entries) {
    const crdName = catalogCrdName(entry.name, entry.project_id);
    const verdict = await applyCatalogEntry(deps, entry, crdName);

    if (verdict.state === "transient") {
      return { kind: "transient", message: verdict.message };
    }
    recordVerdict(tally, entry, verdict);
  }

  return { kind: "ok", tally };
}
