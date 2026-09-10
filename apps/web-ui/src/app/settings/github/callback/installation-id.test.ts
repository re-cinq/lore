import { describe, it, expect } from "vitest";
import { installationIdFrom } from "./installation-id";

describe("installationIdFrom", () => {
  it("reads installation 81234567 from GitHub's setup redirect", () => {
    expect(
      installationIdFrom({
        installation_id: "81234567",
        setup_action: "install",
      }),
    ).toBe(81234567);
  });

  it("reads no installation from a redirect without an id or with not-a-number", () => {
    expect([
      installationIdFrom({ setup_action: "install" }),
      installationIdFrom({ installation_id: "not-a-number" }),
    ]).toEqual([null, null]);
  });
});
