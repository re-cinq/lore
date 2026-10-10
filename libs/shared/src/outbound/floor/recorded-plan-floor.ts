// A recorded floor that answers the planning line's reads from a scripted scene: what the plan verbs and a spec PR's close are tested against.
import type { Report, RunView, VisitView } from "@re-cinq/floor-client";
import {
  recordedFloor,
  type FloorRequest,
  type RecordedFloor,
} from "./recorded-floor.js";

export interface PlanFloorScene {
  /** Newest first, as the floor lists them. */
  runs?: RunView[];
  /** The visits of each run, by run id, oldest first. */
  visits?: Record<string, VisitView[]>;
}

export const PLAN_BLOB_HASH = "blob-1";

const OPEN_RUN: RunView = {
  id: "run-open",
  lineId: "feature-planning",
  lineHash: "hash",
  repo: "github.com/re-cinq/lore",
  subjectKey: "plan_id:p1",
  startItems: {
    repo: {
      kind: "git",
      ref: "github.com/re-cinq/lore@lore/feature-planning/p1",
      by: "lore",
    },
    plan_id: { kind: "value", ref: "p1", by: "lore" },
  },
  outcome: null,
  reason: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  finishedAt: null,
};

const UNSTARTED_VISIT: VisitView = {
  id: "visit",
  runId: "run-open",
  nodeId: "node",
  iteration: 1,
  stationHash: null,
  agentDefinitionHash: null,
  brief: { needs: {}, iteration: 1 },
  report: null,
  worker: null,
  branch: null,
  requestedBy: null,
  deadline: null,
  resumedFrom: null,
  openedAt: "2026-10-01T09:00:00.000Z",
  finishedAt: null,
  agentSettings: null,
};

export function planRun(overrides: Partial<RunView> = {}): RunView {
  return { ...OPEN_RUN, ...overrides };
}

export function planVisit(
  nodeId: string,
  report: Report | null,
  overrides: Partial<VisitView> = {},
): VisitView {
  return {
    ...UNSTARTED_VISIT,
    id: `visit-${nodeId}`,
    nodeId,
    report,
    ...overrides,
  };
}

export function recordedPlanFloor(scene: PlanFloorScene = {}): RecordedFloor {
  return recordedFloor((request) => answerOf(request, scene));
}

type Answer = (url: URL, scene: PlanFloorScene) => unknown;

const ANSWERS: Partial<Record<string, Answer>> = {
  "/assembly-runs": (url, scene) => ({
    items: runsAsked(url, scene),
    nextCursor: null,
  }),
  "/station-runs": (url, scene) => ({
    items: scene.visits?.[url.searchParams.get("run") ?? ""] ?? [],
  }),
  "/blobs": () => ({ hash: PLAN_BLOB_HASH, size: 10 }),
};

function answerOf(request: FloorRequest, scene: PlanFloorScene): unknown {
  const url = new URL(request.path, "http://floor.test");
  const answer =
    ANSWERS[url.pathname] ??
    (url.pathname.endsWith("/start") ? startedOf : eventPosted);

  return answer(url, scene);
}

const eventPosted: Answer = () => ({ id: "event-1" });

// A start on a subject that has an open run joins it, as the floor does.
const startedOf: Answer = (_url, scene) => {
  const open = scene.runs?.find((run) => run.finishedAt === null);

  return open
    ? { run: open, joined: true }
    : { run: planRun({ id: "run-new" }), joined: false };
};

function runsAsked(url: URL, scene: PlanFloorScene): RunView[] {
  const { searchParams } = url;
  const openOnly = searchParams.get("open") === "true";
  const line = searchParams.get("line");
  const limit = Number(searchParams.get("limit") ?? Infinity);

  return (scene.runs ?? [])
    .filter((run) => !openOnly || run.finishedAt === null)
    .filter((run) => line === null || run.lineId === line)
    .slice(0, limit);
}
