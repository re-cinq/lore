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
});
