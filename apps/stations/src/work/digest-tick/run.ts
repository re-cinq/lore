// Binds the digest tick to the ports this process holds (composition root).
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { pipeline, settings } from "../../outbound/queues.js";
import { digestTick } from "./digest-tick.js";

export const NO_FLOOR =
  "no external floor configured: the Floor walks the digest";

export async function runDigestTick(
  params: Readonly<Record<string, unknown>>,
): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }

  return digestTick(params, {
    repoSettings: () => settings().onboardedRepoSettings(),
    posts: pipeline().digestPosts,
    now: () => new Date(),
    floor: floorClient(),
  });
}
