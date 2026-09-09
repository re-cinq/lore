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
  it("falls back to LORE_INGEST_TOKEN during the boot window before the per-agent token is available", () => {
    const env = { LORE_INGEST_TOKEN: "ingest-tok" } as NodeJS.ProcessEnv;
    // agentToken is undefined: registration has not yet completed (boot window).
    const fn = selectReporterToken(env, () => undefined);

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

  // specs/running-stations-in-any-k8s-cluster#FR5
  it("switches to the per-agent token on a central cluster once registration completes, using LORE_INGEST_TOKEN only as a boot-window fallback", () => {
    let agentToken: string | undefined = undefined;
    const env = { LORE_INGEST_TOKEN: "ingest-tok" } as NodeJS.ProcessEnv;
    const fn = selectReporterToken(env, () => agentToken);

    // Boot window: registration has not completed yet — fall back to LORE_INGEST_TOKEN.
    expect(fn()).toBe("ingest-tok");

    // Registration complete: the per-agent token is now the credential that
    // authenticates against pipeline.cluster_agents, and must be preferred.
    agentToken = "per-agent-tok";
    expect(fn()).toBe("per-agent-tok");
  });
});
