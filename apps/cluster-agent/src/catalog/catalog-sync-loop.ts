// Pull-based catalog sync (claim loop's fan-out sibling): polls catalog-events, applies entries idempotently (at-least-once delivery), gates the claim loop's start on the first full snapshot.

import { errorMessage } from "@re-cinq/lore-shared";
import {
  backoffDelay,
  runPollLoop,
} from "@re-cinq/lore-shared/lib/poll-loop.js";
import {
  agentDefToCrds,
  catalogCrdName,
  SYNC_MANAGED_BY,
  UI_MANAGED_BY,
  validateCatalogEntry,
  type CatalogCrdOptions,
} from "@re-cinq/lore-shared/project/agents/agent-crd.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { isPermanentApplyError } from "../kernel/k8s-errors.js";
import type { ResolvedAgentDefinition } from "@re-cinq/lore-shared/models/agent-definition.js";
import type { CatalogApplyReport } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import type { ClusterAgentIdentity } from "../claim/identity-store.js";
import { secondsEnvMs } from "../claim/intervals.js";

const SYNC_TIMEOUT_MS = 30_000;

export const SYNC_BASE_INTERVAL_S_DEFAULT = 30;
export const SYNC_MAX_IDLE_DELAY_MS = 300_000;

export function syncIntervalMs(env: NodeJS.ProcessEnv): number {
  return secondsEnvMs(
    env.LORE_CLUSTER_AGENT_CATALOG_SYNC_INTERVAL_S,
    SYNC_BASE_INTERVAL_S_DEFAULT,
  );
}

// Per-cluster CRD render values, read from env instead of the Helm seed; an unset value omits its block (right for a satellite with no MCP/events/skills).
export function crdOptionsFromEnv(env: NodeJS.ProcessEnv): CatalogCrdOptions {
  return {
    ...(env.LORE_AGENT_EVENTS_URL
      ? { eventsUrl: env.LORE_AGENT_EVENTS_URL }
      : {}),
    ...(env.LORE_MCP_URL ? { mcpUrl: env.LORE_MCP_URL } : {}),
    ...(env.LORE_SKILLS_URL ? { skillsUrl: env.LORE_SKILLS_URL } : {}),
    ...(env.LORE_API_URL ? { apiUrl: env.LORE_API_URL } : {}),
    ...(env.LORE_AGENT_LLM_SECRET_KEY
      ? { llmSecretKey: env.LORE_AGENT_LLM_SECRET_KEY }
      : {}),
    ...(env.LORE_STATION_IMAGE ? { stationImage: env.LORE_STATION_IMAGE } : {}),
    ...(env.LORE_DGRAPH_HTTP ? { dgraphUrl: env.LORE_DGRAPH_HTTP } : {}),
    ...(env.LORE_MODEL_SECRET_KEYS
      ? { modelSecretKeys: parseModelSecretKeys(env.LORE_MODEL_SECRET_KEYS) }
      : {}),
  };
}

// `{"gemini":"GEMINI_API_KEY"}` family→key map; JSON both ends so a malformed value throws at boot instead of silently degrading validation to the bare-cluster pass.
export function parseModelSecretKeys(raw: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw);

  enforceTrue(
    parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.entries(parsed).every(
        ([family, key]) =>
          family.length > 0 && typeof key === "string" && key.length > 0,
      ),
    Error,
    `LORE_MODEL_SECRET_KEYS must be a JSON object of family→secret-key strings, got: ${raw}`,
  );

  return parsed as Record<string, string>;
}

// What this cluster CLAIMS to offer — declared, never inferred from env vars (the 2026-09-01 incident: an undeclared full cluster silently rendered bare).
export function catalogProfile(env: NodeJS.ProcessEnv): "full" | "bare" {
  const raw = env.LORE_CATALOG_PROFILE;

  // Only the exact words — coercing near-matches would put the incident one typo away.
  enforceTrue(
    raw === undefined || raw === "" || raw === "full" || raw === "bare",
    Error,
    `unknown LORE_CATALOG_PROFILE "${raw}" — expected "full" or "bare"`,
  );

  return raw === "full" ? "full" : "bare";
}

export function enforceCatalogProfile(env: NodeJS.ProcessEnv): void {
  if (catalogProfile(env) !== "full") {
    return;
  }

  for (const name of [
    "LORE_MCP_URL",
    "LORE_SKILLS_URL",
    "LORE_AGENT_EVENTS_URL",
  ] as const) {
    enforceTrue(
      env[name],
      Error,
      `cluster-agent cannot start: LORE_CATALOG_PROFILE=full but ${name} is unset — a full cluster rendering recipes without it produces pods that die at boot (see the 2026-09-01 settings.json incident). Set the value or declare the cluster bare.`,
    );
  }

  // Credential axis of the same incident class: a full cluster with no anthropic key would render every default recipe secretless while validation passes.
  enforceTrue(
    env.LORE_AGENT_LLM_SECRET_KEY ||
      (env.LORE_MODEL_SECRET_KEYS &&
        parseModelSecretKeys(env.LORE_MODEL_SECRET_KEYS).anthropic),
    Error,
    "cluster-agent cannot start: LORE_CATALOG_PROFILE=full but no anthropic credential key is configured (LORE_AGENT_LLM_SECRET_KEY or modelSecretKeys.anthropic) — every default recipe would render without its LLM secret.",
  );
}

/** The catalog-events response body (200). */
interface CatalogEventsResponse {
  mode: "snapshot" | "tail";
  cursor: string;
  entries: Array<{
    name: string;
    project_id: string | null;
    definition: ResolvedAgentDefinition | null;
  }>;
}

export type CatalogSyncOutcome =
  | {
      kind: "synced";
      applied: number;
      deleted: number;
      /** CRs another writer owns (label named per entry), left untouched. */
      skipped: string[];
      /** Entries the render contract or the apiserver refused permanently —
       *  acked past, each with its reason, so they surface instead of loop. */
      refused: string[];
    }
  | { kind: "empty" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

/** Empties back off like the claim loop; a synced batch polls again at the base (catalog edits are human-paced). */
export function nextSyncDelay(
  baseMs: number,
  idleTicks: number,
  outcome: CatalogSyncOutcome["kind"],
  maxIdleMs: number = SYNC_MAX_IDLE_DELAY_MS,
): number {
  if (outcome !== "empty") {
    return baseMs;
  }

  return backoffDelay(baseMs, idleTicks, maxIdleMs);
}

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

/** A live CR labeled by neither the sync loop nor the UI belongs to someone else. */
async function checkCrdOwnership(
  catalog: CatalogTarget,
  crdName: string,
): Promise<CrdOwnership> {
  const live = await catalog.getAgentDefinition(crdName);
  const managedBy = live?.metadata?.labels?.["app.kubernetes.io/managed-by"];
  const foreign =
    live !== null &&
    managedBy !== SYNC_MANAGED_BY &&
    managedBy !== UI_MANAGED_BY;

  return foreign ? { writable: false, managedBy } : { writable: true };
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

/** One poll: fetch the unapplied batch, land every entry, remember the cursor to ack next call. Never throws. `snapshot` forces a full boot resync, repairing a lost or differently-rendered apply (#1727). */
type FetchOutcome =
  | { kind: "batch"; body: CatalogEventsResponse }
  | { kind: "refused"; outcome: CatalogSyncOutcome };

/** Ask for the next batch of catalog events. Every way this can fail — unreachable, unauthorized, refused, unparseable — comes back as an outcome the caller reports without advancing the ack. */
async function fetchCatalogBatch(
  deps: CatalogSyncTickDeps,
  ack: string | undefined,
  snapshot: boolean,
): Promise<FetchOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  const { id, token } = deps.identity();
  const params = new URLSearchParams();

  if (ack !== undefined) {
    params.set("ack", ack);
  }

  if (snapshot) {
    params.set("snapshot", "1");
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  let res: Response;

  try {
    res = await fetchFn(
      `${deps.apiUrl}/api/cluster-agents/${id}/catalog-events${query}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      },
    );
  } catch (err) {
    return refusedFetch(`catalog-events fetch failed: ${errorMessage(err)}`);
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

function refusedFetch(message: string): FetchOutcome {
  return { kind: "refused", outcome: { kind: "error", message } };
}

/** What one entry did. `transient` is the only verdict that stops the batch: the ack stays put so the whole batch re-serves. */
type EntryVerdict =
  | { state: "applied" | "deleted" }
  | { state: "skipped" | "refused"; detail: string; reason: string }
  | { state: "transient"; message: string };

/** Land one catalog entry as a CRD pair. */
async function applyCatalogEntry(
  deps: CatalogSyncTickDeps,
  entry: CatalogEventsResponse["entries"][number],
  crdName: string,
): Promise<EntryVerdict> {
  try {
    // Ownership check FIRST, for deletes too — a null-definition event must never remove a seed-owned or hand-applied CR.
    const ownership = deps.ownSeeded
      ? { writable: true as const }
      : await checkCrdOwnership(deps.catalog, crdName);

    if (!ownership.writable) {
      const owner = ownership.managedBy ?? "an unlabeled writer";

      return {
        state: "skipped",
        detail: `${crdName} (${ownership.managedBy ?? "unlabeled"})`,
        reason: `owned by ${owner}`,
      };
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
    // A 400/422 can never succeed, so it refuses; anything else is transient and keeps the ack so the batch re-serves.
    if (isPermanentApplyError(err)) {
      const reason = `${errorMessage(err)} (pair may be half-applied — Station half lands first)`;

      return { state: "refused", detail: `${crdName}: ${reason}`, reason };
    }

    return {
      state: "transient",
      message: `catalog entry ${crdName} failed to land: ${errorMessage(err)}`,
    };
  }
}

export async function catalogSyncOnce(
  deps: CatalogSyncTickDeps,
  ack: string | undefined,
  snapshot = false,
): Promise<{ outcome: CatalogSyncOutcome; ack: string | undefined }> {
  const fetched = await fetchCatalogBatch(deps, ack, snapshot);

  if (fetched.kind === "refused") {
    return { outcome: fetched.outcome, ack };
  }
  const body = fetched.body;

  if (body.entries.length === 0) {
    // Ack still advances — a snapshot of an empty catalog must still land the agent in tail mode.
    return { outcome: { kind: "empty" }, ack: body.cursor };
  }

  let applied = 0;
  let deleted = 0;
  const skippedNames: string[] = [];
  const refused: string[] = [];
  // Structured verdicts for the status report — a log line dies with the pod (2026-09-01).
  const reports: CatalogApplyReport[] = [];

  for (const entry of body.entries) {
    const crdName = catalogCrdName(entry.name, entry.project_id);
    const verdict = await applyCatalogEntry(deps, entry, crdName);

    if (verdict.state === "transient") {
      return { outcome: { kind: "error", message: verdict.message }, ack };
    }

    if (verdict.state === "applied") {
      applied += 1;
    }

    if (verdict.state === "deleted") {
      deleted += 1;
    }

    if (verdict.state === "skipped") {
      skippedNames.push(verdict.detail);
    }

    if (verdict.state === "refused") {
      refused.push(verdict.detail);
    }
    reports.push({
      name: entry.name,
      projectId: entry.project_id,
      state: verdict.state,
      reason: "reason" in verdict ? verdict.reason : null,
    });
  }

  // Best effort, after the applies — a cluster that cannot report must keep syncing; a failed report costs visibility, never delivery.
  await reportStatus(deps, reports);

  return {
    outcome: {
      kind: "synced",
      applied,
      deleted,
      skipped: skippedNames,
      refused,
    },
    ack: body.cursor,
  };
}

/** POST the batch's verdicts. Never throws: visibility must not cost delivery. */
async function reportStatus(
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

export interface CatalogSyncLoopDeps {
  sync: (
    ack: string | undefined,
    snapshot: boolean,
  ) => Promise<{ outcome: CatalogSyncOutcome; ack: string | undefined }>;
  /** The single-flight re-registration a 401/403 rotates through. */
  reRegister: () => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  baseDelayMs: number;
  running: () => boolean;
  /** Resolved once after the first successful sync — the gate the claim loop's start awaits. */
  onFirstSync?: () => void;
}

export async function runCatalogSyncLoop(
  deps: CatalogSyncLoopDeps,
): Promise<void> {
  let ack: string | undefined;
  let first = true;
  // True until one sync actually LANDS (synced or empty), so a failed first poll does not eat the boot resync.
  let resync = true;

  await runPollLoop<CatalogSyncOutcome>({
    tick: async () => {
      const result = await deps.sync(ack, resync);

      ack = result.ack;

      return result.outcome;
    },
    onOutcome: async (outcome) => {
      if (outcome.kind === "unauthorized") {
        await deps.reRegister();

        return;
      }

      if (outcome.kind === "error") {
        console.warn(`[cluster-agent] catalog sync: ${outcome.message}`);

        return;
      }

      if (outcome.kind === "synced") {
        console.log(
          `[cluster-agent] catalog sync landed ${outcome.applied} applied, ${outcome.deleted} deleted, ${outcome.skipped.length} not-owned skipped, ${outcome.refused.length} refused`,
        );

        for (const name of outcome.skipped) {
          console.log(
            `[cluster-agent] catalog sync skipped ${name} — not this loop's to write`,
          );
        }

        for (const refusal of outcome.refused) {
          console.warn(`[cluster-agent] catalog sync REFUSED ${refusal}`);
        }
      }

      // Reached only for synced/empty — resync landed, so later polls tail from the acked cursor.
      resync = false;

      if (first) {
        first = false;
        deps.onFirstSync?.();
      }
    },
    delayFor: (outcome, idleTicks) =>
      nextSyncDelay(deps.baseDelayMs, idleTicks, outcome.kind),
    isIdle: (outcome) => outcome.kind === "empty",
    sleep: deps.sleep,
    running: deps.running,
  });
}
