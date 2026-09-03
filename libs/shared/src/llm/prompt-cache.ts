/** Prompt-caching helpers (Anthropic-specific): cache-control markers on system+tools, optional 1h TTL gated per job, and a djb2-hash break classifier explaining WHY a cache miss happened. */

import type Anthropic from "@anthropic-ai/sdk";

/** Local extension of CacheControlEphemeral: @anthropic-ai/sdk ≤ 0.39 types don't expose the API's 1h TTL; remove once the SDK pin is bumped past the types refresh. */
export type CacheControl = Anthropic.CacheControlEphemeral & {
  ttl?: "5m" | "1h";
};

// ── 1-hour TTL eligibility ─────────────────────────────────────────

// Jobs with a stable system prompt clustering within an hour benefit from the 1h TTL (~2x write cost, amortized across >1 hit/hour). Override via LORE_CACHE_1H_JOBS: ""/unset=default, "none"=off, "*"=all, "a,b,c"=allowlist.
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

// Latch eligibility once at module load — prevents mid-process env changes from toggling TTL, which would bust the server-side cache.
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

/** Returns the cache_control object for a job; callers attach it to the last block of each cacheable prefix (system, tools). */
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

/** Hashes the cacheable prefix (system + tool schemas) so later calls can detect whether a "cache miss" is a prompt change or a TTL expiry. */
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

// Long-lived process; in-memory is enough — restarts reset tracking.
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

/** Classifies a cache miss; call AFTER the LLM call returns so cache_read_tokens is visible. Reads/writes module-level state keyed by jobName. */
/** What this call observed once the response came back. */
interface CacheObservation {
  isHit: boolean;
  cacheCreationTokens: number;
  now: number;
}

function classifyCacheBreak(
  prev: CacheState | undefined,
  newHash: PrefixHash,
  { isHit, cacheCreationTokens, now }: CacheObservation,
): CacheBreakAnalysis {
  if (isHit) {
    return { status: "hit" };
  }

  if (!prev) {
    return { status: "first-call" };
  }
  const systemChanged = prev.systemHash !== newHash.system;
  const toolsChanged = prev.toolsHash !== newHash.tools;
  const promptUnchanged = !(systemChanged || toolsChanged);

  if (promptUnchanged && cacheCreationTokens > 0) {
    // Hashes match but we paid to write again — prefix aged out
    return {
      status: "ttl-expired",
      ageMinutes: Math.round((now - prev.lastCallAt) / 60_000),
    };
  }

  if (promptUnchanged) {
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
  const analysis = classifyCacheBreak(prev, newHash, {
    isHit,
    cacheCreationTokens,
    now,
  });

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
