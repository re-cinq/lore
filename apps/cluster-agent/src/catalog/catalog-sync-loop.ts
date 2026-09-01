/**
 * The pull-based catalog sync loop (the fan-out sibling of the claim loop):
 * poll `GET /api/cluster-agents/{id}/catalog-events`, and apply every entry it
 * returns to THIS cluster — build the AgentDefinition + Station pair from the
 * resolved definition with this cluster's own env-derived values, or delete the
 * pair when the definition resolved to null. Pull for the same reason claim
 * pulls: a satellite is unreachable for inbound calls, so a /agents save can
 * only reach it by being fetched.
 *
 * Delivery is at-least-once: the server re-serves the same batch until the
 * NEXT call acks the cursor this one finished applying, and the apply itself
 * is merge-onto-live idempotent, so a crash mid-batch re-applies instead of
 * skipping. The first successful sync of a fresh agent is the full snapshot —
 * the bootstrap guarantee the Helm catalog-seed hook used to provide — which
 * is why the claim loop's start is gated on it: an Agent CR must never be
 * created before its stationRef target exists in this cluster.
 *
 * Every side effect is injected (fetch, catalog, sleep) so each tick and the
 * schedule test without a cluster or a network.
 */

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

/**
 * The per-cluster values the CRD builder renders — everything the Helm chart
 * used to substitute into the committed catalog seed, now read from THIS
 * process's environment. An unset value omits the block it feeds (the seed's
 * guard rule), which is exactly right on a satellite that has no MCP gateway,
 * events sink or skills registry to point at.
 */
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

/**
 * `{"gemini":"GEMINI_API_KEY"}` → the family→key map the render and validator
 * consult. JSON on both ends — the chart serializes with `toJson` — because a
 * hand-rolled k=v codec pair drops malformed entries SILENTLY, and a silently
 * absent family degrades validation to the bare-cluster pass: the
 * misconfigured-full-cluster class again. A set-but-unparseable value throws
 * out of boot instead.
 */
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

/**
 * What this cluster CLAIMS to offer, declared — never inferred from which env
 * vars happen to be set. `full` is a cluster with the platform around it (MCP
 * gateway, skills registry, events sink); `bare` is a satellite that renders
 * recipes without those blocks ON PURPOSE. The 2026-09-01 incident was a full
 * cluster rendering the bare shape because two env vars went unset: with the
 * profile declared, that misconfiguration refuses to boot instead.
 */
export function catalogProfile(env: NodeJS.ProcessEnv): "full" | "bare" {
  const raw = env.LORE_CATALOG_PROFILE;

  // Only the exact words: for a knob whose whole point is "declared, never
  // inferred", coercing "Full"/"ful"/"true" to the permissive value would put
  // the incident one typo away.
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

  // The credential axis of the same incident class: a full cluster with no
  // anthropic key renders every default recipe secretless while validation
  // passes (an empty map reads as a deliberate bare cluster).
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

/** Empties back off exactly like the claim loop; a synced batch polls again at
 *  the base (no rush — catalog edits are human-paced), and errors are not
 *  idleness. */
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

/** The three catalog operations a sync needs — the routes' applyPair/deletePair
 *  plus the read the seed-ownership guard makes. */
export interface CatalogTarget {
  applyPair(pair: {
    agentDefinition: AgentDefinition;
    station: Station;
  }): Promise<void>;
  deletePair(name: string): Promise<void>;
  getAgentDefinition(name: string): Promise<AgentDefinition | null>;
}

export interface CatalogSyncTickDeps {
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  catalog: CatalogTarget;
  crdOptions: CatalogCrdOptions;
  /**
   * Transition guard: while the Helm catalog-seed hook still runs (its
   * server-side apply force-claims ownership on every deploy), this loop
   * SKIPS CRs the seed labeled rather than fighting it — two writers with
   * even slightly different renders would silently flap. Set
   * LORE_CATALOG_SYNC_OWN_SEEDED=1 at cutover (seedCatalog: false) and the
   * loop takes them over; the label persists on the object, so an
   * unconditional skip would orphan every org default forever.
   */
  ownSeeded: boolean;
  fetchFn?: typeof fetch;
}

/** One poll: fetch the unapplied batch, land every entry, remember the cursor
 *  to ack on the NEXT call. Never throws — every failure shape is an outcome. */
export async function catalogSyncOnce(
  deps: CatalogSyncTickDeps,
  ack: string | undefined,
): Promise<{ outcome: CatalogSyncOutcome; ack: string | undefined }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const { id, token } = deps.identity();
  const query = ack === undefined ? "" : `?ack=${ack}`;

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
    return {
      outcome: {
        kind: "error",
        message: `catalog-events fetch failed: ${errorMessage(err)}`,
      },
      ack,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { outcome: { kind: "unauthorized" }, ack };
  }

  if (!res.ok) {
    return {
      outcome: {
        kind: "error",
        message: `catalog-events refused (HTTP ${res.status})`,
      },
      ack,
    };
  }

  let body: CatalogEventsResponse;

  try {
    body = (await res.json()) as CatalogEventsResponse;
  } catch (err) {
    return {
      outcome: {
        kind: "error",
        message: `catalog-events response parse failed: ${errorMessage(err)}`,
      },
      ack,
    };
  }

  if (body.entries.length === 0) {
    // Nothing to apply, but the ack still advances (a snapshot of an empty
    // catalog must still land the agent in tail mode).
    return { outcome: { kind: "empty" }, ack: body.cursor };
  }

  let applied = 0;
  let deleted = 0;
  const skippedNames: string[] = [];
  const refused: string[] = [];

  for (const entry of body.entries) {
    const crdName = catalogCrdName(entry.name, entry.project_id);

    try {
      // Ownership FIRST — for deletes as much as applies: a null-definition
      // event must not remove a seed-owned org default (delete/re-seed flap)
      // or an operator's hand-applied CR. While the transition holds the loop
      // owns its own label, the UI push's (that render is degraded on purpose
      // and this loop's validated render repairing it is the point), and what
      // does not exist yet. The seed label stays the chart's until cutover,
      // and an UNLABELED live CR is a human's — never clobbered, never
      // validated, never REFUSED-logged on their behalf.
      if (!deps.ownSeeded) {
        const live = await deps.catalog.getAgentDefinition(crdName);
        const managedBy =
          live?.metadata?.labels?.["app.kubernetes.io/managed-by"];

        if (
          live !== null &&
          managedBy !== SYNC_MANAGED_BY &&
          managedBy !== UI_MANAGED_BY
        ) {
          skippedNames.push(`${crdName} (${managedBy ?? "unlabeled"})`);
          continue;
        }
      }

      if (entry.definition === null) {
        await deps.catalog.deletePair(crdName);
        deleted += 1;
        continue;
      }

      // The render contract, BEFORE the render: a refusal is permanent for
      // this (row, cluster) pair — only a new event or new cluster config
      // changes the answer — so the loop acks past it. Re-serving it instead
      // is how one dead row (`def-github_action`, 422 forever) head-of-line
      // blocked the entire tail for two hours on 2026-09-01. The previous CR,
      // if any, stays live: last-known-good beats unbootable.
      const refusal = validateCatalogEntry(entry.definition, deps.crdOptions);

      if (refusal !== null) {
        refused.push(`${crdName}: ${refusal}`);
        continue;
      }
      await deps.catalog.applyPair(
        agentDefToCrds(entry.definition, deps.crdOptions),
      );
      applied += 1;
    } catch (err) {
      // The apiserver's verdict decides the retry: a 400/422 can never
      // succeed (the validator's backstop), so it refuses and the loop moves
      // on; anything else is transient — keep the ack so the batch re-serves.
      // Known edge, accepted: applyCatalogPair writes Station first, so a
      // permanent rejection of the AgentDefinition half leaves the new
      // Station template live beside the old recipe — the refusal names it.
      if (isPermanentApplyError(err)) {
        refused.push(
          `${crdName}: ${errorMessage(err)} (pair may be half-applied — Station half lands first)`,
        );
        continue;
      }

      return {
        outcome: {
          kind: "error",
          message: `catalog entry ${crdName} failed to land: ${errorMessage(err)}`,
        },
        ack,
      };
    }
  }

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

export interface CatalogSyncLoopDeps {
  sync: (
    ack: string | undefined,
  ) => Promise<{ outcome: CatalogSyncOutcome; ack: string | undefined }>;
  /** The single-flight re-registration a 401/403 rotates through. */
  reRegister: () => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  baseDelayMs: number;
  running: () => boolean;
  /** Resolved once, after the first successful sync (snapshot applied or
   *  already in tail) — the gate the claim loop's start awaits. */
  onFirstSync?: () => void;
}

export async function runCatalogSyncLoop(
  deps: CatalogSyncLoopDeps,
): Promise<void> {
  let ack: string | undefined;
  let first = true;

  await runPollLoop<CatalogSyncOutcome>({
    tick: async () => {
      const result = await deps.sync(ack);

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
