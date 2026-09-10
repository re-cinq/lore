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
});
