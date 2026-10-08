// Lists the plan sections a round writes, one entry each, so the floor runs a pod per section at once: the sections not yet done, or the ones the gate sent back. The bag's `section_state` is its memory; the `assemble` station that joins the pods settles what they returned (see specs/7-feature-planning/spec.md FR-24).

import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import type { CitablePlan } from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import {
  emptySectionState,
  startRound,
  type RedoRequest,
  type SectionState,
} from "@re-cinq/lore-shared/feature-planning/spec-sections.js";

export function splitSectionsHandle(): Handle {
  return async (_brief, tools) => {
    const [plan, state, redo] = await Promise.all([
      readJson<CitablePlan>(tools, "plan_blocks"),
      readJson<SectionState>(tools, "section_state"),
      readJson<RedoRequest>(tools, "redo_sections"),
    ]);
    const round = plan
      ? startRound(plan, state ?? emptySectionState(), redo)
      : { items: [], state: state ?? emptySectionState() };

    await tools.produce("section_state", JSON.stringify(round.state));

    // The list is a value: the floor counts a fan-out's branches from the report, not from a file.
    return {
      outcome: "success",
      produced: { sections: JSON.stringify(round.items) },
    };
  };
}

async function readJson<T>(tools: Tools, need: string): Promise<T | null> {
  const text = (await tools.read(need)).toString("utf8");

  try {
    return text === "" ? null : (JSON.parse(text) as T);
  } catch {
    return null;
  }
}

export function startSplitSectionsStation(): RunningStation {
  return defineStation("split-sections", splitSectionsHandle());
}
