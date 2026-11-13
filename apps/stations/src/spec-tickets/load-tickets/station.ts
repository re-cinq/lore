// Lists the tickets an earlier run filed for the spec, as a file the decompose agent reads, so a rerun rewrites those issues instead of filing a second set; and the statement lines their linked tests settle, so the agent assesses only the rest.
import {
  defineStation,
  type Brief,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { eventLine } from "@re-cinq/lore-assembly-lines";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { specFilingKey } from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";
import {
  settledListing,
  settledStatements,
} from "@re-cinq/lore-shared/spec-tickets/settled-statements.js";
import {
  specBaseline,
  type BaselineSources,
  type PlannedSpec,
  type SpecBaseline,
} from "@re-cinq/lore-shared/spec-tickets/spec-baseline.js";
import { projectFor } from "../../outbound/project-boot.js";
import { existingPlanIssues } from "../../planning/file-issues/plan-issue-filing.js";
import { ticketsListing } from "./listing.js";

type FiledIssues = (
  repo: string,
  filingKey: string,
) => ReturnType<typeof existingPlanIssues>;

export interface LoadTicketsDeps {
  filed: FiledIssues;
  /** The floor's runs of the line and the repository's files and commits, for the spec's baseline. */
  sourcesFor(repo: string): Promise<BaselineSources>;
}

/** The settled lines as the decompose agent and the verify step read them, and a log line saying what they were compared with. */
interface SettledFile {
  listing: string;
  summary: string;
}

/** The spec a load visit settles lines of, at the merge its brief names, if any. */
type LoadedSpec = Omit<PlannedSpec, "mergeSha"> & {
  mergeSha: string | undefined;
};

const productionDeps: LoadTicketsDeps = {
  filed: async (repo, filingKey) =>
    existingPlanIssues(await projectFor(repo), filingKey),
  sourcesFor: async (repo) => {
    const files = (await projectFor(repo)).repo;

    return {
      floor: floorClient(),
      readSpec: (path, ref) => files.read(path, ref),
      firstParent: async (sha) => {
        const history = await files.branchHistory(sha, { limit: 1 });
        const parents = history.at(0)?.parents ?? [];

        return parents.at(0) ?? null;
      },
    };
  },
};

export function loadTicketsHandle(deps: LoadTicketsDeps): Handle {
  return async ({ needs }, tools) => {
    try {
      const loaded = loadedSpecOf(needs);

      await produceTickets(deps, loaded, tools);
      await produceSettled(deps, loaded, tools);

      return { outcome: "success" };
    } catch (err) {
      const message = (err as Error).message;

      console.log(eventLine(`spec-tickets-load failed: ${message}`));

      return { outcome: "failed", error: message };
    }
  };
}

function loadedSpecOf(needs: Brief["needs"]): LoadedSpec {
  const { repo } = parseGitRef(needs.target);

  return { repo, specPath: needs.spec_path, mergeSha: mergeShaOf(needs) };
}

/** `merge_sha` reaches this step only from line versions that pass it on, so a brief may carry none. */
function mergeShaOf(
  needs: Partial<Record<string, string>>,
): string | undefined {
  return needs.merge_sha;
}

async function produceTickets(
  deps: LoadTicketsDeps,
  { repo, specPath }: LoadedSpec,
  tools: Tools,
): Promise<void> {
  const { tasks } = await deps.filed(repo, specFilingKey(specPath));

  await tools.produce(
    "existing_tickets",
    JSON.stringify(ticketsListing(tasks), null, 2),
  );
}

// A brief that names no merge settles nothing (specs/spec-tickets FR25).
async function produceSettled(
  deps: LoadTicketsDeps,
  { mergeSha, ...spec }: LoadedSpec,
  tools: Tools,
): Promise<void> {
  if (mergeSha === undefined) {
    return;
  }
  const planned = { ...spec, mergeSha };
  const settled = await settledAt(await deps.sourcesFor(spec.repo), planned);

  if (settled === null) {
    return;
  }
  await tools.produce("settled_statements", settled.listing);
  console.log(eventLine(settled.summary));
}

// A merge that holds no such spec settles nothing; the verify step reports it.
async function settledAt(
  sources: BaselineSources,
  planned: PlannedSpec,
): Promise<SettledFile | null> {
  const spec = await sources.readSpec(planned.specPath, planned.mergeSha);

  if (spec === null) {
    return null;
  }
  const baseline = await specBaseline(sources, planned);
  const settled = await settledStatements({
    spec,
    specPath: planned.specPath,
    read: (path) => sources.readSpec(path, planned.mergeSha),
    baseline,
  });

  return {
    listing: settledListing(baseline.commit, settled),
    summary: settledSummary(planned, baseline, settled.length),
  };
}

function settledSummary(
  planned: PlannedSpec,
  baseline: SpecBaseline,
  count: number,
): string {
  const since = baseline.commit ?? "no earlier spec";

  return `spec-tickets-load settled ${count} statement lines of ${planned.specPath} at ${planned.mergeSha}, compared with ${since} and ${baseline.statements.length} earlier verdicts`;
}

export function startLoadTicketsStation(): RunningStation {
  return defineStation("spec-tickets-load", loadTicketsHandle(productionDeps));
}
