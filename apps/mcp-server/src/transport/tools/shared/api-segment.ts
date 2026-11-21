import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { z } from "zod";

/** A value that would climb out of its place in a path, or leave it empty. Encoding does not help: a URL parser reads `..` as a dot segment however it is written. */
function leavesItsSegment(value: string): boolean {
  return value === "" || value === "." || value === "..";
}

/** A caller-supplied id as a tool argument, when the id becomes one segment of a lore-api path. */
export const idParam = z
  .string()
  .min(1)
  .refine((id) => !leavesItsSegment(id), {
    message: "an id, not a path",
  });

/** One caller-supplied value as exactly one segment of a lore-api path: encoded, so it cannot add a segment, a query or a fragment, and refused when it is a dot segment. Every tool that builds a path from an argument goes through here. */
export function apiSegment(value: string): string {
  enforceTrue(
    !leavesItsSegment(value),
    Error,
    "an id was expected, not a path",
  );

  return encodeURIComponent(value);
}
