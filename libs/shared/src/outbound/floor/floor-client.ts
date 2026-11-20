// The external floor (re-cinq/floor), reached the only way anything outside it may: its typed HTTP client.
import {
  createFloorClient,
  serviceToken,
  type FloorClient,
  type RunView,
} from "@re-cinq/floor-client";
import { enforceTrue } from "../../lib/enforce.js";
import {
  MirrorRefusal,
  withMirrorRefusal,
  type MirrorOwnerOf,
} from "./mirror-refusal.js";

export type { RunView };

export type FloorEnv = Partial<
  Record<"FLOOR_API_URL" | "FLOOR_SERVICE_TOKEN", string>
>;

/** False on a deployment that was given no floor, so a caller can leave its floor work unstarted instead of throwing at boot. */
export function floorConfigured(env: FloorEnv = process.env): boolean {
  return Boolean(env.FLOOR_API_URL && env.FLOOR_SERVICE_TOKEN);
}

export function floorClientFrom(env: FloorEnv): FloorClient {
  enforceTrue(
    env.FLOOR_API_URL && env.FLOOR_SERVICE_TOKEN,
    Error,
    "FLOOR_API_URL and FLOOR_SERVICE_TOKEN must both be set to reach the floor",
  );

  return createFloorClient({
    url: env.FLOOR_API_URL,
    token: serviceToken(env.FLOOR_SERVICE_TOKEN),
  });
}

let client: FloorClient | undefined;
let mirrorOwnerOf: MirrorOwnerOf | null = null;

/** How this process learns which repo publishes to a given one: the process that owns a database hands its settings in at boot, since this package opens no pool. */
export function useMirrorOwner(ownerOf: MirrorOwnerOf | null): void {
  mirrorOwnerOf = ownerOf;
}

const mirrorOwnerNow: MirrorOwnerOf = (repo) => {
  enforceTrue(
    mirrorOwnerOf,
    MirrorRefusal,
    "no mirror lookup was given to this process: the floor starts nothing until it has one",
  );

  return mirrorOwnerOf(repo);
};

/** The one floor client a line is started through: it refuses a start for a repo that is another repo's public mirror. */
export function floorClient(): FloorClient {
  client ??= withMirrorRefusal(floorClientFrom(process.env), mirrorOwnerNow);

  return client;
}

/** The floor, or null on a deployment that was given none: for a read that simply has nothing to add there. */
export function floorIfConfigured(): FloorClient | null {
  return floorConfigured() ? floorClient() : null;
}
