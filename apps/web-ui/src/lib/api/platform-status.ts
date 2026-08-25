import "server-only";
import { apiFetch } from "./client";

// Whether the factory's model access is down right now (#1455).
//
// A person on a feature page whose round just failed should learn that the
// platform is out of credit, not read a per-run failure and reach for Retry —
// which is what happened for two hours on 2026-08-20.

export interface PlatformLlmStatus {
  degraded: boolean;
  failure_class: string | null;
  detail: string | null;
  since: string | null;
  affected_runs: number;
}

const HEALTHY: PlatformLlmStatus = {
  degraded: false,
  failure_class: null,
  detail: null,
  since: null,
  affected_runs: 0,
};

/**
 * The platform's LLM health, or "healthy" if the read failed for any reason.
 *
 * Fail-quiet on purpose: this is a banner above someone else's work. A status
 * endpoint that is unreachable must not put an outage notice on a page — being
 * unable to confirm an outage is not evidence of one.
 */
export async function getPlatformLlmStatus(): Promise<PlatformLlmStatus> {
  const result = await apiFetch<PlatformLlmStatus>(
    "lore-api",
    "/api/platform/llm-status",
    { revalidate: 30 },
  );

  return result.status === "ok" ? result.data : HEALTHY;
}
