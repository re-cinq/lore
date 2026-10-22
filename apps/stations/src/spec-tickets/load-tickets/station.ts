// Lists the tickets an earlier run filed for the spec, as a file the decompose agent reads, so a rerun rewrites those issues instead of filing a second set.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { eventLine } from "@re-cinq/lore-assembly-lines";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { specFilingKey } from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";
import { projectFor } from "../../outbound/project-boot.js";
import { existingPlanIssues } from "../../planning/file-issues/plan-issue-filing.js";
import { ticketsListing } from "./listing.js";

type FiledIssues = (
  repo: string,
  filingKey: string,
) => ReturnType<typeof existingPlanIssues>;

const productionFiled: FiledIssues = async (repo, filingKey) =>
  existingPlanIssues(await projectFor(repo), filingKey);

export function loadTicketsHandle(filed: FiledIssues): Handle {
  return async (brief, tools) => {
    try {
      const { repo } = parseGitRef(brief.needs.target);
      const { tasks } = await filed(repo, specFilingKey(brief.needs.spec_path));

      await tools.produce(
        "existing_tickets",
        JSON.stringify(ticketsListing(tasks), null, 2),
      );

      return { outcome: "success" };
    } catch (err) {
      const message = (err as Error).message;

      console.log(eventLine(`spec-tickets-load failed: ${message}`));

      return { outcome: "failed", error: message };
    }
  };
}

export function startLoadTicketsStation(): RunningStation {
  return defineStation("spec-tickets-load", loadTicketsHandle(productionFiled));
}
