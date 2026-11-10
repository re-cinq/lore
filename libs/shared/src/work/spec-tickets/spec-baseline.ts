// What a spec-tickets run compares its spec with before it takes a linked statement as present: the spec as the last run to finish planning it read it, with what that run found (specs/spec-tickets FR25).
import type { FloorClient, RunView } from "@re-cinq/floor-client";
import {
  parseDecomposition,
  type StatementAssessment,
} from "../../domain/feature-planning/decomposition-result.js";
import { floorRepoOf } from "../../outbound/floor/floor-items.js";
import { SPEC_TICKETS_LINE } from "./floor-spec-tickets.js";
import type { SettleBaseline } from "./settled-statements.js";

type Floor = Pick<FloorClient, "runs" | "blobs">;

export interface BaselineSources {
  floor: {
    runs: Pick<Floor["runs"], "list" | "get">;
    blobs: Pick<Floor["blobs"], "get">;
  };
  /** The file as the commit holds it; null when the commit has none. */
  readSpec(path: string, ref: string): Promise<string | null>;
  /** The commit's first parent; null when it has none. */
  firstParent(sha: string): Promise<string | null>;
}

/** The spec a run plans, at the merge that started it. */
export interface PlannedSpec {
  repo: string;
  specPath: string;
  mergeSha: string;
}

/** A baseline with the commit its spec was read at; both are null together. */
export interface SpecBaseline extends SettleBaseline {
  commit: string | null;
}

/** A finished run of the spec, by the merge it planned. */
interface EarlierRun {
  id: string;
  commit: string;
  succeeded: boolean;
}

const PAGE_SIZE = 200;
// Past a thousand finished runs the lookup stops, and the spec is compared with what the oldest run it reached saw.
const PAGES = 5;
const NOTHING: SpecBaseline = { commit: null, spec: null, statements: [] };

/** The spec as its newest successful run planned it, with that run's verdicts. While no run of it has succeeded: the spec as it stood before the first run that tried, so nothing a failed run was started for is taken as planned. */
export async function specBaseline(
  sources: BaselineSources,
  planned: PlannedSpec,
): Promise<SpecBaseline> {
  let untried = planned.mergeSha;

  for await (const run of earlierRuns(sources.floor.runs, planned)) {
    if (run.succeeded) {
      return plannedBy(sources, planned.specPath, run);
    }
    untried = run.commit;
  }

  return before(sources, planned.specPath, untried);
}

/** The finished runs of the spec, newest first. */
async function* earlierRuns(
  runs: BaselineSources["floor"]["runs"],
  { repo, specPath }: PlannedSpec,
): AsyncGenerator<EarlierRun> {
  let cursor: string | undefined;

  for (let page = 0; page < PAGES; page += 1) {
    const { items: finished, nextCursor } = await runs.list(
      { repo: floorRepoOf(repo), line: SPEC_TICKETS_LINE, open: false },
      { limit: PAGE_SIZE, cursor },
    );

    yield* finished.flatMap((run) => earlierRunOf(run, specPath));

    if (nextCursor === null) {
      return;
    }
    cursor = nextCursor;
  }
}

// A run key is unique per merge, so the spec is matched on the start item that names it.
function earlierRunOf(run: RunView, specPath: string): EarlierRun[] {
  const startItems: Partial<Record<string, { ref: string }>> = run.startItems;
  const commit = startItems["merge_sha"]?.ref;

  if (startItems["spec_path"]?.ref !== specPath || commit === undefined) {
    return [];
  }

  return [{ id: run.id, commit, succeeded: run.outcome === "success" }];
}

async function plannedBy(
  sources: BaselineSources,
  specPath: string,
  run: EarlierRun,
): Promise<SpecBaseline> {
  const [spec, statements] = await Promise.all([
    sources.readSpec(specPath, run.commit),
    verdictsOf(sources.floor, run.id),
  ]);

  return spec === null ? NOTHING : { commit: run.commit, spec, statements };
}

/** What the run's verification left each statement as; none for a run that kept no verified decomposition, or whose copy the floor no longer holds. */
async function verdictsOf(
  floor: BaselineSources["floor"],
  runId: string,
): Promise<StatementAssessment[]> {
  const bag: Partial<Record<string, { ref: string }>> =
    (await floor.runs.get(runId))?.bag ?? {};
  const hash = bag["verified_decomposition"]?.ref;
  const stored = hash === undefined ? null : await floor.blobs.get(hash);

  return stored ? verdictsIn(new TextDecoder().decode(stored.bytes)) : [];
}

// A copy that does not read as a decomposition holds nothing: a throw here would fail every later run of the spec at its first step.
function verdictsIn(decomposition: string): StatementAssessment[] {
  try {
    return parseDecomposition(JSON.parse(decomposition)).statements ?? [];
  } catch {
    return [];
  }
}

/** The spec as it stood before the commit, with no verdicts. */
async function before(
  sources: BaselineSources,
  specPath: string,
  sha: string,
): Promise<SpecBaseline> {
  const commit = await sources.firstParent(sha);
  const spec =
    commit === null ? null : await sources.readSpec(specPath, commit);

  return spec === null ? NOTHING : { commit, spec, statements: [] };
}
