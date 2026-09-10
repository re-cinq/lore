import { describe, it, expect } from "vitest";
import { callbackOutcome } from "./callback-outcome";

describe("callbackOutcome", () => {
  it("goes back to the settings page once re-cinq's installation is recorded", () => {
    expect(
      callbackOutcome({
        status: "ok",
        data: {
          installation_id: "81234567",
          account_login: "re-cinq",
          account_type: "Organization",
          repository_selection: "selected",
          suspended_at: null,
          installed_at: "2026-09-10T20:00:00.000Z",
          updated_at: "2026-09-10T20:00:00.000Z",
        },
      }),
    ).toEqual({ redirectTo: "/settings" });
  });

  it("explains that nothing was recorded when lore-api answers 404 not-an-installation-of-this-app", () => {
    expect(
      callbackOutcome({
        status: "error",
        message: "not-an-installation-of-this-app",
        code: 404,
      }),
    ).toEqual({
      error:
        "GitHub does not know that installation as one of this App's, so nothing was recorded.",
    });
  });

  it("explains an unconfigured web UI or a 500 upstream exploded instead of returning to settings", () => {
    expect([
      callbackOutcome({ status: "unconfigured" }),
      callbackOutcome({
        status: "error",
        message: "upstream exploded",
        code: 500,
      }),
    ]).toEqual([
      {
        error:
          "The web UI cannot reach lore-api, so the installation was not recorded.",
      },
      { error: "Recording the installation failed: upstream exploded" },
    ]);
  });
});
