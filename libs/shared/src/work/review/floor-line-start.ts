// Starting a line on the floor, with the one refusal that outlasts a rollout told apart from the rest.
import {
  isFloorProblem,
  type FloorClient,
  type FloorProblem,
  type StartedRun,
} from "@re-cinq/floor-client";

type LineStarter = Pick<FloorClient["lines"], "start">;

const HTTP_BAD_REQUEST = 400;

/** 2+4+...+256+300 seconds of bus backoff, about 13 minutes: longer than a lore-api rollout that puts the pipelines on the floor. */
export const LINE_NOT_YET_ON_FLOOR_ATTEMPTS = 10;

/** A start the floor refuses for lack of the line usually means lore-api has not put the pipelines there yet, so it is thrown with a retry budget that outlasts a rollout; every other error passes through as it came. */
export async function startLine(
  lines: LineStarter,
  ...starting: Parameters<LineStarter["start"]>
): Promise<StartedRun> {
  try {
    return await lines.start(...starting);
  } catch (err) {
    throw lineMissing(err) ? patient(err) : err;
  }
}

function lineMissing(err: unknown): err is FloorProblem {
  return (
    isFloorProblem(err) &&
    err.status === HTTP_BAD_REQUEST &&
    /no line named/.test(err.detail ?? "")
  );
}

function patient(err: Error): Error {
  return Object.assign(
    new Error(`the floor does not have the line yet: ${err.message}`),
    { maxAttempts: LINE_NOT_YET_ON_FLOOR_ATTEMPTS },
  );
}
