/**
 * Prompt-caching helpers (Anthropic-specific; internal to the Anthropic
 * provider). Inspired by patterns observed in the public Claude Code source
 * mirror (tanbiralam/claude-code) — specifically the getCacheControl +
 * should1hCacheTTL split and the cache-break diagnostic state tracker.
 *
 * Scope (what we implement):
 *   - Cache-control markers on both system prompt AND tool definitions
 *   - Optional 1-hour TTL, gated per job name via env
 *   - djb2 prefix hashing + in-memory break classifier so the log
 *     line tells us WHY a cache miss happened (first call, prompt
 *     changed, TTL expired, unknown)
 *
 * Out of scope (keeping it simple for now):
 *   - Per-tool hashing (we only have 1 tool per request)
 *   - Bedrock/Anthropic 3P provider splits
 *   - Disk-persisted cache state (single-process is fine)
 *   - Cache-control on message blocks (all our calls are single-turn)
 */

import type Anthropic from "@anthropic-ai/sdk";

/**
 * Local extension of the Anthropic SDK's CacheControlEphemeral.
 *
 * The 1-hour cache TTL feature shipped in the Anthropic API but
 * @anthropic-ai/sdk ≤ 0.39 types don't expose it. The API accepts
 * `ttl: '1h'` on the cache_control block regardless. Using this
 * type everywhere we emit cache_control keeps the API-level truth
 * visible in the source while satisfying tsc on the pinned SDK.
 * Remove this alias and use Anthropic.CacheControlEphemeral once
 * the SDK pin is bumped past the types refresh.
 */
export type CacheControl = Anthropic.CacheControlEphemeral & {
  ttl?: "5m" | "1h";
};

// ── 1-hour TTL eligibility ─────────────────────────────────────────

// Jobs whose calls have a stable system prompt AND tend to cluster
// within an hour benefit from the extended 1h cache TTL. A 1h write
// costs ~2x the normal input price, so only mark jobs that will
// amortize it across >1 hit per hour on average.
//
// Override via LORE_CACHE_1H_JOBS env:
//   - "" / unset: use DEFAULT_1H_JOBS below
//   - "none":     no job gets 1h TTL
//   - "*":        every job gets 1h TTL (wildcard)
//   - "a,b,c":    comma-separated allowlist
const DEFAULT_1H_JOBS = new Set([
  "auto-curation",
  "review_reactor",
  "fact-extraction",
  "graph-extraction",
]);

function resolveEligibility(): { allEligible: boolean; jobs: Set<string> } {
  const raw = process.env.LORE_CACHE_1H_JOBS;

  if (raw === undefined || raw === "") {
    return { allEligible: false, jobs: DEFAULT_1H_JOBS };
  }

  if (raw === "*") {
    return { allEligible: true, jobs: new Set() };
  }

  if (raw.toLowerCase() === "none") {
    return { allEligible: false, jobs: new Set() };
  }

  return {
    allEligible: false,
    jobs: new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
}

// Latch eligibility once at module load. Matches Claude Code's
// should1hCacheTTL session-stable pattern — prevents mid-process env
// changes from toggling TTL, which would bust the server-side cache.
const ELIGIBILITY = resolveEligibility();

export function shouldUse1hTTL(jobName?: string): boolean {
  if (ELIGIBILITY.allEligible) {
    return true;
  }

  if (!jobName) {
    return false;
  }

  return ELIGIBILITY.jobs.has(jobName);
}

// ── Cache-control factory ──────────────────────────────────────────

/**
 * Return the cache_control object for a given job. Callers attach
 * it to the last block of each cacheable prefix (system, tools).
 */
export function getCacheControl(jobName?: string): CacheControl {
  if (shouldUse1hTTL(jobName)) {
    return { type: "ephemeral", ttl: "1h" };
  }

  return { type: "ephemeral" };
}

// ── Hashing ────────────────────────────────────────────────────────

/** djb2 — deterministic across runs and runtime-independent. */
export function djb2Hash(str: string): string {
  let hash = 5381;

  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }

  return (hash >>> 0).toString(16);
}

interface ToolShape {
  name: string;
  description: string;
  input_schema: unknown;
}

export interface PrefixHash {
  system: string;
  tools: string;
}

/**
 * Hash the cacheable prefix (system + tool schemas) so later calls
 * can detect whether their "cache miss" is due to a prompt change
 * or a TTL expiry.
 */
export function computeCachePrefixHash(
  systemPrompt: string | undefined,
  tools?: ToolShape[],
): PrefixHash {
  const system = systemPrompt ? djb2Hash(systemPrompt) : "";
  const toolsHash =
    tools && tools.length > 0
      ? djb2Hash(
          JSON.stringify(
            tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.input_schema,
            })),
          ),
        )
      : "";

  return { system, tools: toolsHash };
}

// ── Cache-break analysis ───────────────────────────────────────────

interface CacheState {
  systemHash: string;
  toolsHash: string;
  lastCallAt: number;
}

// Long-lived process; in-memory is enough. Restarts reset tracking.
const cacheStateByJob = new Map<string, CacheState>();

export type CacheStatus =
  | "hit" // cache_read > 0
  | "first-call" // no prior state for this jobName
  | "prompt-changed" // hashes differ vs last call
  | "ttl-expired" // hashes match but no read — prefix was evicted
  | "unknown-miss"; // catch-all

export interface CacheBreakAnalysis {
  status: CacheStatus;
  /** For "prompt-changed": which prefix changed — "system", "tools", or "system+tools" */
  reason?: string;
  /** For "ttl-expired": how long since the last call, in minutes */
  ageMinutes?: number;
}

/**
 * Classify a cache miss and update the tracker. Call AFTER the LLM
 * call returns so we can see cache_read_tokens. Pure enough to unit
 * test — reads/writes module-level state keyed by jobName.
 */
function classifyCacheBreak(
  prev: CacheState | undefined,
  newHash: PrefixHash,
  isHit: boolean,
  cacheCreationTokens: number,
  now: number,
): CacheBreakAnalysis {
  if (isHit) {
    return { status: "hit" };
  }

  if (!prev) {
    return { status: "first-call" };
  }
  const systemChanged = prev.systemHash !== newHash.system;
  const toolsChanged = prev.toolsHash !== newHash.tools;

  if (!(systemChanged || toolsChanged)) {
    if (cacheCreationTokens > 0) {
      // Hashes match but we paid to write again — prefix aged out
      return {
        status: "ttl-expired",
        ageMinutes: Math.round((now - prev.lastCallAt) / 60_000),
      };
    }

    return { status: "unknown-miss" };
  }
  const parts: string[] = [];

  if (systemChanged) {
    parts.push("system");
  }

  if (toolsChanged) {
    parts.push("tools");
  }

  return { status: "prompt-changed", reason: parts.join("+") };
}

export function analyzeCacheBreak(
  jobName: string | undefined,
  newHash: PrefixHash,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): CacheBreakAnalysis {
  const key = jobName || "_unnamed";
  const prev = cacheStateByJob.get(key);
  const now = Date.now();
  const isHit = cacheReadTokens > 0;
  const analysis = classifyCacheBreak(
    prev,
    newHash,
    isHit,
    cacheCreationTokens,
    now,
  );

  cacheStateByJob.set(key, {
    systemHash: newHash.system,
    toolsHash: newHash.tools,
    lastCallAt: now,
  });

  return analysis;
}

/** Test helper — reset the in-memory tracker. Never call in production. */
export function __resetCacheStateForTests(): void {
  cacheStateByJob.clear();
}
