import { describe, it, expect } from "vitest";
import { releaseNowOutcome } from "./release-now-outcome";

describe("releaseNowOutcome", () => {
  it("answers run run-7 and joined false for a started release", () => {
    expect(
      releaseNowOutcome({
        status: "ok",
        data: { runId: "run-7", joined: false },
      }),
    ).toEqual({ ok: true, runId: "run-7", joined: false });
  });

  it("answers joined true for a run already open for the commit", () => {
    expect(
      releaseNowOutcome({
        status: "ok",
        data: { runId: "run-7", joined: true },
      }),
    ).toEqual({ ok: true, runId: "run-7", joined: true });
  });

  it("says the repository is a public mirror for a 409", () => {
    expect(
      releaseNowOutcome({ status: "error", message: "HTTP 409", code: 409 }),
    ).toEqual({
      ok: false,
      said: "Could not start the release: this repository is another repository's public mirror, and that one is released instead.",
    });
  });

  it("says Lore cannot start releases right now for a 503", () => {
    expect(
      releaseNowOutcome({ status: "error", message: "no_floor", code: 503 }),
    ).toEqual({
      ok: false,
      said: "Could not start the release: Lore has no floor or database to run it on right now. Try again in a minute.",
    });
  });

  it("names lore-api's message for any other failure", () => {
    expect(
      releaseNowOutcome({
        status: "error",
        message: "unknown repo",
        code: 404,
      }),
    ).toEqual({
      ok: false,
      said: "Could not start the release: unknown repo.",
    });
  });

  it("says the Lore API is unconfigured when the web UI has no session", () => {
    expect(releaseNowOutcome({ status: "unconfigured" })).toEqual({
      ok: false,
      said: "Could not start the release: Lore API unconfigured.",
    });
  });
});
