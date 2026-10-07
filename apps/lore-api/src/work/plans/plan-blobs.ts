// The plan files a planning run downloads, stored as floor blobs: the hash is what a report or a start carries.

import type { CitablePlan } from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import type { PlanFloor } from "./floor-plan-line.js";

type Blobs = Pick<PlanFloor, "blobs">;

/** The plan as the blob the run's agents download as plan.md. */
export async function storeMarkdown(
  floor: Blobs,
  planMarkdown: string,
): Promise<string> {
  return storeBlob(floor, planMarkdown, "text/markdown");
}

/** The citable blocks as the blob the spec writer and the coverage check download as plan-blocks.json; none when the plan came without them. */
export async function storeCitable(
  floor: Blobs,
  citablePlan: CitablePlan | undefined,
): Promise<{ plan_blocks?: string }> {
  if (!citablePlan) {
    return {};
  }
  const json = JSON.stringify(citablePlan);

  return { plan_blocks: await storeBlob(floor, json, "application/json") };
}

async function storeBlob(
  floor: Blobs,
  content: string,
  contentType: string,
): Promise<string> {
  const stored = await floor.blobs.put(
    new TextEncoder().encode(content),
    contentType,
  );

  return stored.hash;
}
