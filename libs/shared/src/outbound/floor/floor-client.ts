// The external floor (re-cinq/floor), reached the only way anything outside it may: its typed HTTP client.
import {
  createFloorClient,
  serviceToken,
  type FloorClient,
} from "@re-cinq/floor-client";
import { enforceTrue } from "../../lib/enforce.js";

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

export function floorClient(): FloorClient {
  client ??= floorClientFrom(process.env);

  return client;
}
