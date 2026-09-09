import { describe, it, expect } from "vitest";
import { selectReporterToken } from "./select-reporter-token.js";

describe("selectReporterToken — one credential, chosen at boot", () => {
  it("falls back to LORE_INGEST_TOKEN during the boot window before the per-agent token is available", () => {
    const env = { LORE_INGEST_TOKEN: "ingest-tok" } as NodeJS.ProcessEnv;
    const fn = selectReporterToken(env, () => undefined);

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

    env.LORE_INGEST_TOKEN = "ingest-tok";

    expect(fn()).toBe("agent-tok");
  });

  it("switches to the per-agent token on a central cluster once registration completes, using LORE_INGEST_TOKEN only as a boot-window fallback", () => {
    let agentToken: string | undefined = undefined;
    const env = { LORE_INGEST_TOKEN: "ingest-tok" } as NodeJS.ProcessEnv;
    const fn = selectReporterToken(env, () => agentToken);

    expect(fn()).toBe("ingest-tok");

    agentToken = "per-agent-tok";
    expect(fn()).toBe("per-agent-tok");
  });
});
