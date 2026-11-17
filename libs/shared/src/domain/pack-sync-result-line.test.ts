import { describe, expect, it } from "vitest";
import { packSyncResultLine } from "./pack-sync-result-line.js";

describe("packSyncResultLine", () => {
  it("names the commit and the agents an applied pack changed", () => {
    expect(
      packSyncResultLine({
        status: "applied",
        commit: "a1b2c3d",
        changed: ["triager", "reviewer"],
      }),
    ).toBe("pack a1b2c3d applied: triager, reviewer");
  });

  it("says none changed when the applied pack changed nothing", () => {
    expect(
      packSyncResultLine({ status: "applied", commit: "a1b2c3d", changed: [] }),
    ).toBe("pack a1b2c3d applied: none changed");
  });

  it("says no pack is configured when LORE_PACK_REPO is unset", () => {
    expect(packSyncResultLine({ status: "unconfigured" })).toBe(
      "no pack configured on this deployment",
    );
  });

  it("names the error of a failed sync and that the floor keeps what it holds", () => {
    expect(
      packSyncResultLine({ status: "failed", error: "404 acme/lore-pack" }),
    ).toBe(
      "pack sync FAILED, the floor keeps what it holds: 404 acme/lore-pack",
    );
  });

  it("says another replica holds the lease when the sync was skipped", () => {
    expect(packSyncResultLine({ skipped: "lease held" })).toBe(
      "pack sync skipped: another replica holds the lease",
    );
  });
});
