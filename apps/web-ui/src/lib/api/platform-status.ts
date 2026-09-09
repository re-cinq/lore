import "server-only";
import { apiFetch } from "./client";

// Whether the factory's model access is down right now (#1455) — a failed round should surface "out of credit", not send a person to hit Retry (happened for 2h on 2026-08-20).
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

/** Fail-quiet on purpose (banner above someone else's work): an unreachable status endpoint reports "healthy" rather than an outage it can't confirm. */
export async function getPlatformLlmStatus(): Promise<PlatformLlmStatus> {
  const result = await apiFetch<PlatformLlmStatus>(
    "lore-api",
    "/api/platform/llm-status",
    { revalidate: 30 },
  );

  return result.status === "ok" ? result.data : HEALTHY;
}
