import { apiSegment, idParam } from "../shared/api-segment.js";

/** A plan's id as a tool argument. */
export const planIdParam = idParam;

/** The lore-api path of one plan's sub-resource, with the id kept to one segment. */
export function planPath(planId: string, resource: string): string {
  return `/api/plans/${apiSegment(planId)}/${resource}`;
}
