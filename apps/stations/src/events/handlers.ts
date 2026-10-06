// One handler per subscribed event name, resolved the same way the Floor's registry does, so both drainers agree on retry, dead-lettering, and the visibility budget.

import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { STATIONS } from "../work/registry.js";
import {
  eventTriggerNames,
  type SweepStationModule,
} from "../work/lib/station.js";
import { stationHost } from "./runner/station-host.js";
import { autoReviewEnabled } from "@re-cinq/lore-shared/review/code-review-decisions.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { projectFor } from "../outbound/project-boot.js";
import { settings } from "../outbound/queues.js";
import {
  floorReviewHandlers,
  type FloorReviewDeps,
} from "./floor-review-handlers.js";
import {
  floorPlanHandlers,
  type FloorPlanDeps,
} from "./floor-plan-handlers.js";
import { addHandlers } from "./compose-handlers.js";
import { dropOverlayOverHttp } from "@re-cinq/lore-shared/project/lib/station-http.js";
import { pipeline } from "../outbound/queues.js";
import { repoEventHandlers, type RepoEventDeps } from "./repo-handlers.js";
import {
  floorRepoOf,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import { reportToVisit } from "@re-cinq/lore-shared/floor/floor-report.js";
import { relocateOnTeamChange } from "./team-changed.js";
import { chunkSchemaOrOrgShared } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";
import { PgChunks } from "@re-cinq/lore-shared/project/chunks/chunks-pg.js";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";

const floorReviewDeps: FloorReviewDeps = {
  autoReview: async (repo) =>
    autoReviewEnabled(await settings().rawSettings(repo)),
  review: async (repo) => {
    const { pulls, issues } = await projectFor(repo);

    return {
      floor: floorClient(),
      pulls,
      issues,
      uiUrl: process.env.LORE_UI_URL,
    };
  },
};

const floorPlanDeps: FloorPlanDeps = { floor: floorClient };

async function findParkedVisitId(
  floor: ReturnType<typeof floorClient>,
  run: { id: string; startItems: Record<string, { ref: string }> },
  issueNumber: number,
): Promise<string | null> {
  const { startItems } = run;
  const issueItem = startItems["issue_number"];

  if (issueItem?.ref !== String(issueNumber)) {
    return null;
  }
  const visits = await floor.stationRuns.list({ run: run.id });
  const parked = visits.findLast(
    (v) => v.nodeId === "human-gate" && v.report === null,
  );

  return parked?.id ?? null;
}

const repoEventDeps: RepoEventDeps = {
  labelDispatch: async (repo) => {
    const { issues } = await projectFor(repo);

    return {
      rawSettings: (name) => settings().rawSettings(name),
      activeTaskByIssue: (name, issueNumber) =>
        pipeline().taskQueue.activeTaskByIssue(name, issueNumber),
      addLabel: (issueNumber, label) => issues.addLabel(issueNumber, label),
      comment: (issueNumber, body) => issues.comment(issueNumber, body),
    };
  },
  renameRepo: (from, to) => settings().renameRepo(from, to),
  // This service holds no graph client: the drop goes through lore-api.
  dropOverlay: (repo, branch) => dropOverlayOverHttp({ repo, branch }),
  relocateChunks: (repo) =>
    relocateOnTeamChange(
      {
        team: (name) => settings().team(name),
        chunkSchema: (team) => chunkSchemaOrOrgShared(getPool(), team),
        relocate: (schema, name) =>
          new PgChunks(getPool()).relocateLegacyChunks(schema, name),
      },
      repo,
    ),
  startIssueTriage: async (repo, issueNumber, issueUrl) => {
    const started = await startLine(floorClient().lines, "issue-triage", {
      repo: floorRepoOf(repo),
      startItems: {
        issue_number: valueItem(issueNumber),
        repo: valueItem(repo),
        issue_url: valueItem(issueUrl),
      },
    });

    return started.run.id;
  },
  findParkedTriageVisit: async (repo, issueNumber) => {
    const floor = floorClient();
    const { items: runs } = await floor.runs.list({
      repo: floorRepoOf(repo),
      line: "issue-triage",
      open: true,
    });

    for (const run of runs) {
      const visitId = await findParkedVisitId(floor, run, issueNumber);

      if (visitId !== null) {
        return visitId;
      }
    }

    return null;
  },
  reportTriageGate: (visitId) =>
    reportToVisit(floorClient().events, visitId, { outcome: "success" }),
};

// Runs the sweep that declared this event trigger — derived from the manifests like the subscription set, so a station can't subscribe without a handler and get silently dead-lettered.
const runSweepFor =
  (mod: SweepStationModule, eventName: string): EventHandler =>
  async (params, meta) => {
    const summary = await mod.run({
      trigger: "event",
      event: { name: eventName, params, eventId: meta?.eventId ?? "" },
      host: stationHost(),
    });

    console.log(`[station] ${mod.manifest.name}: ${summary}`);
  };

export function buildStationHandlers(): Map<string, EventHandler> {
  const handlers = new Map<string, EventHandler>();

  const sweepBindings = Object.values(STATIONS).flatMap((mod) =>
    eventTriggerNames(mod.manifest).map((eventName) => ({ mod, eventName })),
  );

  for (const { mod, eventName } of sweepBindings) {
    handlers.set(eventName, runSweepFor(mod, eventName));
  }

  addHandlers(handlers, repoEventHandlers(repoEventDeps));

  if (floorConfigured()) {
    addHandlers(handlers, floorReviewHandlers(floorReviewDeps));
    addHandlers(handlers, floorPlanHandlers(floorPlanDeps));
  }

  return handlers;
}
