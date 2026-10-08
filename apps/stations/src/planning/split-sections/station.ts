// Lists the plan sections a round writes, one entry each, so the floor runs a pod per section at once: the sections not yet done, or the ones the gate sent back. The bag's `section_state` is its memory; the `assemble` station that joins the pods settles what they returned (see specs/7-feature-planning/spec.md FR-24).

import {
  defineStation,
  type Brief,
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
import { optionalNeedText } from "../../domain/need-text.js";

export function splitSectionsHandle(): Handle {
  return async (brief, tools) => {
    const [plan, state, redo] = await Promise.all([
      readJson<CitablePlan>(brief, tools, "plan_blocks"),
      readJson<SectionState>(brief, tools, "section_state"),
      readJson<RedoRequest>(brief, tools, "redo_sections"),
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

/** An optional need, as JSON; null when the bag holds none yet (the first round) or it is not JSON. */
async function readJson<T>(
  brief: Brief,
  tools: Tools,
  need: string,
): Promise<T | null> {
  const text = await optionalNeedText(brief.needs, tools, need);

  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export function startSplitSectionsStation(): RunningStation {
  return defineStation("split-sections", splitSectionsHandle());
}
