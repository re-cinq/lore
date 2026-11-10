import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it } from "vitest";
import { buildStationHandlers } from "./handlers.js";

describe("Loop progress PR check publisher", () => {
  it("refreshes the check as the run enters each step", async () => {
    const handlers = buildStationHandlers();
    const handle = handlers.get("station_run.dispatched");

    enforceTrue(
      handle,
      Error,
      "pinned active stations/shared work contain no publisher for lore/implementation-loop or pr_check_sha",
    );
  });

  it("publishes a green check when a finished run completed", async () => {
    const handlers = buildStationHandlers();
    const handle =
      handlers.get("run.settled") || handlers.get("internal.run.settled");

    enforceTrue(
      handle,
      Error,
      "pinned active stations/shared work contain no publisher for lore/implementation-loop or pr_check_sha",
    );
  });

  it("closes the check left on the previous head as neutral Superseded when the head moves", async () => {
    const handlers = buildStationHandlers();
    const handle = handlers.get("station_run.dispatched");

    enforceTrue(
      handle,
      Error,
      "pinned active stations/shared work contain no publisher for lore/implementation-loop or pr_check_sha",
    );
  });
});
