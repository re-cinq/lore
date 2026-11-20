import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type { SweepStationModule } from "../../work/lib/station.js";
import { stationHost } from "./station-host.js";
import { timedStationRun } from "./timed-station-run.js";

// Runs the sweep that declared this event trigger — derived from the manifests like the subscription set, so a station can't subscribe without a handler and get silently dead-lettered.
export const runSweepFor =
  (mod: SweepStationModule, eventName: string): EventHandler =>
  async (params, meta) => {
    const summary = await timedStationRun(mod.manifest.name, () =>
      mod.run({
        trigger: "event",
        event: { name: eventName, params, eventId: meta?.eventId ?? "" },
        host: stationHost(),
      }),
    );

    console.log(`[station] ${mod.manifest.name}: ${summary}`);
  };
