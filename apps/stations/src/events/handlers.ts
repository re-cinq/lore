// One handler per subscribed event name, resolved the same way the Floor's registry does, so both drainers agree on retry, dead-lettering, and the visibility budget.

import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { STATIONS } from "../work/registry.js";
import {
  eventTriggerNames,
  type SweepStationModule,
} from "../work/lib/station.js";
import { stationHost } from "./runner/station-host.js";
import { timedStationRun } from "./runner/timed-station-run.js";
import { autoReviewEnabled } from "@re-cinq/lore-shared/loops/auto-review-enabled.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { projectFor } from "../outbound/project-boot.js";
import { settings, pipeline, taskStore } from "../outbound/queues.js";
import {
  floorReviewHandlers,
  type FloorReviewDeps,
} from "./floor-review-handlers.js";
import {
  floorPlanHandlers,
  type FloorPlanDeps,
} from "./floor-plan-handlers.js";
import {
  loopMergeHandlers,
  type LoopMergeDeps,
} from "./loop-merge-handlers.js";
import {
  floorSpecTicketsHandlers,
  type FloorSpecTicketsDeps,
} from "./floor-spec-tickets-handlers.js";
import { addHandlers } from "./compose-handlers.js";
import { dropOverlayOverHttp } from "@re-cinq/lore-shared/project/lib/station-http.js";
import { repoEventHandlers, type RepoEventDeps } from "./repo-handlers.js";
import { eventProxy } from "../outbound/queues.js";
import {
  loreApiTarget,
  postUtopiaCommits,
  postUtopiaReleases,
  postUtopiaTracker,
} from "../work/utopia-backfill-tick/lore-api-backfill.js";
import {
  commitsAnswerLine,
  releasesAnswerLine,
  trackerAnswerLine,
} from "../work/utopia-backfill-tick/commits-answer.js";
import { NO_LORE_API } from "../work/utopia-backfill-tick/run.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import type { PullFileChange } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  type ChangedFile,
  runKeysOf,
  SPEC_TICKETS_LINE,
} from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import { issueTriageEnabled } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { reportToVisit } from "@re-cinq/lore-shared/floor/floor-report.js";
import { relocateOnTeamChange } from "./team-changed.js";
import { openPrOnBranch } from "@re-cinq/lore-shared/backlog/ticket-holder.js";
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
      loreAppLogin: await loreAppLogin(),
    };
  },
};

const floorPlanDeps: FloorPlanDeps = { floor: floorClient };

const loopMergeDeps: LoopMergeDeps = {
  settle: {
    floor: floorClient,
    tasks: {
      latestLoopTaskByIssue: (repo, issueNumber) =>
        pipeline().taskQueue.latestLoopTaskByIssue(repo, issueNumber),
      setStatusIf: (id, expected, status, extra) =>
        taskStore().setStatusIf(id, expected, status, extra),
      recordEvent: (id, from, to, meta) =>
        taskStore().recordEvent(id, from, to, meta),
    },
    comment: async (repo, issueNumber, body) =>
      (await projectFor(repo)).issues.comment(issueNumber, body),
    removeLabel: async (repo, issueNumber, label) =>
      (await projectFor(repo)).issues.removeLabel(issueNumber, label),
    closeIssue: async (repo, issueNumber) =>
      (await projectFor(repo)).issues.close(issueNumber, "completed"),
    emitTick: emitLoopTick,
  },
};

/** Queued rather than inserted, so a router blip costs a late tick and not a lost one: the next ticket starts in seconds, not at the next safety tick. Mirrors `loop-closed-deps.ts`'s own `queueLoopTick`. */
function emitLoopTick(repo: string): Promise<void> {
  return eventProxy().emit({
    kind: "event",
    event: {
      eventName: "cron.implementation_loop.tick",
      source: "internal",
      params: { repo },
    },
  });
}

async function changedFilesOf(
  pulls: { listFileChanges(number: number): Promise<PullFileChange[]> },
  prNumber: number,
): Promise<ChangedFile[]> {
  const changes = await pulls.listFileChanges(prNumber);

  return changes.map(({ filename, patch }) => ({ path: filename, patch }));
}

const floorSpecTicketsDeps: FloorSpecTicketsDeps = {
  tickets: async (repo) => {
    const { pulls, repo: files } = await projectFor(repo);

    return {
      floor: floorClient(),
      defaultBranch: () => files.defaultBranch(),
      changedFiles: (_repo, prNumber) => changedFilesOf(pulls, prNumber),
      readSpec: (_repo, path, ref) => files.read(path, ref),
      openRunKeys: async (name) => {
        const open = await floorClient().runs.list({
          repo: floorRepoOf(name),
          line: SPEC_TICKETS_LINE,
          open: true,
        });

        return runKeysOf(open.items);
      },
    };
  },
};

async function findParkedVisitId(
  floor: ReturnType<typeof floorClient>,
  run: { id: string; startItems: Record<string, { ref: string }> },
  issueNumber: number,
): Promise<string | null> {
  const startItems: Partial<Record<string, { ref: string }>> = run.startItems;
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
    const project = await projectFor(repo);
    const { issues } = project;

    return {
      rawSettings: (name) => settings().rawSettings(name),
      activeTaskByIssue: (name, issueNumber) =>
        pipeline().taskQueue.activeTaskByIssue(name, issueNumber),
      openPrForBranch: (_name, branch) => openPrOnBranch(project, branch),
      addLabel: (issueNumber, label) => issues.addLabel(issueNumber, label),
      comment: (issueNumber, body) => issues.comment(issueNumber, body),
    };
  },
  renameRepo: (from, to) => settings().renameRepo(from, to),
  // This service holds no graph client: the drop goes through lore-api.
  dropOverlay: (repo, branch) => dropOverlayOverHttp({ repo, branch }),
  // This service holds no GitHub reader for history and no Utopia key: the walk runs in lore-api.
  mirrorCommits: async (repo, branch) => {
    const target = loreApiTarget();

    return target
      ? commitsAnswerLine(await postUtopiaCommits(target, repo, branch))
      : NO_LORE_API;
  },
  mirrorTracker: async (repo) => {
    const target = loreApiTarget();

    return target
      ? trackerAnswerLine(await postUtopiaTracker(target, repo))
      : NO_LORE_API;
  },
  mirrorReleases: async (repo) => {
    const target = loreApiTarget();

    return target
      ? releasesAnswerLine(await postUtopiaReleases(target, repo))
      : NO_LORE_API;
  },
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
  triageEnabled: async (repo) =>
    issueTriageEnabled(await settings().rawSettings(repo)),
  startIssueTriage: async (repo, issueNumber, issueUrl) => {
    const branch = await (await projectFor(repo)).repo.defaultBranch();
    const started = await startLine(floorClient().lines, "issue-triage", {
      repo: floorRepoOf(repo),
      startItems: {
        target: gitItem(repo, branch),
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
    const summary = await timedStationRun(mod.manifest.name, () =>
      mod.run({
        trigger: "event",
        event: { name: eventName, params, eventId: meta?.eventId ?? "" },
        host: stationHost(),
      }),
    );

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
    addHandlers(handlers, loopMergeHandlers(loopMergeDeps));
    addHandlers(handlers, floorSpecTicketsHandlers(floorSpecTicketsDeps));
  }

  return handlers;
}
