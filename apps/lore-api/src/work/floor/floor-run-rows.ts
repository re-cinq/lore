// The floor's runs as the list page reads them: wire rows with their pull request, cost and mini pipeline, and the floor's own cursor.
import { z } from "zod";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  RunRowSchema,
  toRunRow,
  type RunEnrichment,
} from "../assembly-runs/run-row.js";
import { PipelineNodeSchema } from "../assembly-line-station/mini-pipeline.js";
import type {
  FloorRunListing,
  FloorRunPageQuery,
  FloorRunReader,
} from "./floor-run-reader.js";

export const FloorRunRowSchema = RunRowSchema.extend({
  pipeline: z.array(PipelineNodeSchema),
});

export type FloorRunRow = z.infer<typeof FloorRunRowSchema>;

export const FloorRunPageSchema = z.object({
  runs: z.array(FloorRunRowSchema),
  next_cursor: z.string().nullable(),
});

export type FloorRunSource = Pick<
  FloorRunReader,
  "page" | "listing" | "costsByRun"
>;

/** What a floor run joins beyond itself: its pull request is its own start item and its cost is the floor's sum. */
export function floorEnrichmentOf(
  run: AssemblyRunSummary,
  costUsd: number | undefined,
): RunEnrichment {
  const prUrl = run.args["pr_url"];

  return {
    pr_url: typeof prUrl === "string" ? prUrl : null,
    task_pr_number: null,
    issue_url: null,
    issue_number: null,
    created_by: null,
    cost_usd: costUsd ?? null,
  };
}

function wireRow(
  listing: FloorRunListing,
  costs: ReadonlyMap<string, number>,
): FloorRunRow {
  const enrichment = floorEnrichmentOf(listing.run, costs.get(listing.run.id));

  return { ...toRunRow(listing.run, enrichment), pipeline: listing.pipeline };
}

export class FloorRunRows {
  constructor(private readonly reader: FloorRunSource) {}

  /** One page as the list page reads it: the wire rows and the floor's cursor. Costs are one read for the whole page. */
  async page(
    query: FloorRunPageQuery,
  ): Promise<z.infer<typeof FloorRunPageSchema>> {
    const { runs, nextCursor } = await this.reader.page(query);

    if (runs.length === 0) {
      return { runs: [], next_cursor: nextCursor };
    }
    const costs = await this.reader.costsByRun(runs.map(({ run }) => run));

    return {
      runs: runs.map((listing) => wireRow(listing, costs)),
      next_cursor: nextCursor,
    };
  }

  /** One run as a wire row, for a live update; null for a run the floor does not hold. */
  async row(runId: string): Promise<FloorRunRow | null> {
    const listing = await this.reader.listing(runId);

    if (!listing) {
      return null;
    }
    const costs = await this.reader.costsByRun([listing.run]);

    return wireRow(listing, costs);
  }
}
