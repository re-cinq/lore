// Pull-based catalog sync (claim loop's fan-out sibling): polls catalog-events, applies entries idempotently (at-least-once delivery), gates the claim loop's start on the first full snapshot.

import {
  backoffDelay,
  runPollLoop,
} from "@re-cinq/lore-shared/lib/poll-loop.js";
import type { CatalogCrdOptions } from "@re-cinq/lore-shared/project/agents/agent-crd.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { secondsEnvMs } from "../claim/intervals.js";
import {
  applyBatchEntries,
  type CatalogSyncTickDeps,
} from "./catalog-batch-apply.js";
import { fetchCatalogBatch, reportStatus } from "./catalog-events-http.js";
import type { ResolvedAgentDefinition } from "@re-cinq/lore-shared/models/agent-definition.js";

export type {
  CatalogSyncTickDeps,
  CatalogTarget,
} from "./catalog-batch-apply.js";

export const SYNC_BASE_INTERVAL_S_DEFAULT = 30;
export const SYNC_MAX_IDLE_DELAY_MS = 300_000;

export function syncIntervalMs(env: NodeJS.ProcessEnv): number {
  return secondsEnvMs(
    env.LORE_CLUSTER_AGENT_CATALOG_SYNC_INTERVAL_S,
    SYNC_BASE_INTERVAL_S_DEFAULT,
  );
}

/** One env var → CatalogCrdOptions field mapping; `parse` transforms the raw string when the field isn't a plain passthrough. */
interface CrdOptionEnvMapping {
  envKey: keyof NodeJS.ProcessEnv;
  optionKey: keyof CatalogCrdOptions;
  parse?: (raw: string) => unknown;
}

const CRD_OPTION_ENV_MAPPINGS: CrdOptionEnvMapping[] = [
  { envKey: "LORE_AGENT_EVENTS_URL", optionKey: "eventsUrl" },
  { envKey: "LORE_MCP_URL", optionKey: "mcpUrl" },
  { envKey: "LORE_SKILLS_URL", optionKey: "skillsUrl" },
  { envKey: "LORE_API_URL", optionKey: "apiUrl" },
  { envKey: "LORE_AGENT_LLM_SECRET_KEY", optionKey: "llmSecretKey" },
  { envKey: "LORE_STATION_IMAGE", optionKey: "stationImage" },
  { envKey: "LORE_DGRAPH_HTTP", optionKey: "dgraphUrl" },
  {
    envKey: "LORE_MODEL_SECRET_KEYS",
    optionKey: "modelSecretKeys",
    parse: (raw: string) => parseModelSecretKeys(raw),
  },
];

// Per-cluster CRD render values, read from env instead of the Helm seed; an unset value omits its block (right for a satellite with no MCP/events/skills).
export function crdOptionsFromEnv(env: NodeJS.ProcessEnv): CatalogCrdOptions {
  const options: Record<string, unknown> = {};

  for (const { envKey, optionKey, parse } of CRD_OPTION_ENV_MAPPINGS) {
    const raw = env[envKey];

    if (raw) {
      options[optionKey] = parse ? parse(raw) : raw;
    }
  }

  return options as CatalogCrdOptions;
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
export interface CatalogEventsResponse {
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
      /** Entries render contract/apiserver refused permanently (with reasons, surfaced instead of looping). */
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

  const result = await applyBatchEntries(deps, body.entries);

  if (result.kind === "transient") {
    return { outcome: { kind: "error", message: result.message }, ack };
  }

  // Best effort, after the applies — a cluster that cannot report must keep syncing; a failed report costs visibility, never delivery.
  await reportStatus(deps, result.tally.reports);

  return {
    outcome: {
      kind: "synced",
      applied: result.tally.applied,
      deleted: result.tally.deleted,
      skipped: result.tally.skipped,
      refused: result.tally.refused,
    },
    ack: body.cursor,
  };
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

function logSyncedOutcome(
  outcome: Extract<CatalogSyncOutcome, { kind: "synced" }>,
): void {
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
        logSyncedOutcome(outcome);
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
