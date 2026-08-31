/**
 * The cluster-agent reports with ONE credential, selected at boot, not a
 * per-call fallback chain (FR5 of specs/running-stations-in-any-k8s-cluster).
 *
 * Central cluster: LORE_INGEST_TOKEN is present at boot → captured once,
 * returned on every call regardless of later env changes.
 *
 * Satellite cluster: LORE_INGEST_TOKEN is absent at boot → the per-agent
 * token thunk is returned as-is, so rotations are picked up per-call, and
 * LORE_INGEST_TOKEN appearing later in the env is ignored.
 *
 * The OR pattern (`LORE_INGEST_TOKEN ?? agentToken`, per-call) is the bug
 * this replaces: on a central cluster it falls back to agentToken if
 * LORE_INGEST_TOKEN is temporarily absent; on a satellite it picks up
 * LORE_INGEST_TOKEN if it somehow appears after boot.
 */

import { describe, it, expect } from "vitest";
import { selectReporterToken } from "./select-reporter-token.js";

describe("selectReporterToken — one credential, chosen at boot", () => {
  it("uses LORE_INGEST_TOKEN captured at boot on a central cluster, not read per call", () => {
    const env = { LORE_INGEST_TOKEN: "ingest-tok" } as NodeJS.ProcessEnv;
    const fn = selectReporterToken(env, () => "agent-tok");

    // Remove from env after selection to prove the value was captured, not read live.
    delete env.LORE_INGEST_TOKEN;

    expect(fn()).toBe("ingest-tok");
  });

  it("returns the agentToken thunk unchanged on a satellite, so rotations are still picked up", () => {
    let tok = "agent-tok-1";
    const fn = selectReporterToken({} as NodeJS.ProcessEnv, () => tok);

    expect(fn()).toBe("agent-tok-1");
    tok = "agent-tok-rotated";
    expect(fn()).toBe("agent-tok-rotated");
  });

  it("does not pick up LORE_INGEST_TOKEN that appears in the env after the satellite's token is selected", () => {
    const env = {} as NodeJS.ProcessEnv;
    const fn = selectReporterToken(env, () => "agent-tok");

    // Simulate the token appearing after boot (e.g. accidental mount, env mutation).
    env.LORE_INGEST_TOKEN = "ingest-tok";

    expect(fn()).toBe("agent-tok");
  });
});
