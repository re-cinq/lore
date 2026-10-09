// Lists the plan sections a round writes, one entry each, so the floor runs a pod per section at once: the sections not yet done, or the ones the gate sent back. The bag's `section_state` is its memory, started over when the visit before this one was a new draft; the `assemble` station that joins the pods settles what they returned (see specs/7-feature-planning/spec.md FR-24).

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
import { coverageDeps, type CoverageDeps } from "../coverage-deps.js";

export function splitSectionsHandle(
  deps: Pick<CoverageDeps, "visitsOf">,
): Handle {
  return async (brief, tools) => {
    const [plan, { state, redo }] = await Promise.all([
      readJson<CitablePlan>(brief, tools, "plan_blocks"),
      sectionMemory(deps, brief, tools),
    ]);
    const round = plan ? startRound(plan, state, redo) : { items: [], state };

    await tools.produce("section_state", JSON.stringify(round.state));

    // The list is a value: the floor counts a fan-out's branches from the report, not from a file.
    return {
      outcome: "success",
      produced: { sections: JSON.stringify(round.items) },
    };
  };
}

/** What the run remembers of its sections and the gate's last redo request; a memory started over when this round follows a new draft. */
async function sectionMemory(
  deps: Pick<CoverageDeps, "visitsOf">,
  brief: Brief,
  tools: Tools,
): Promise<{ state: SectionState; redo: RedoRequest | null }> {
  const [remembered, redo, afterDraft] = await Promise.all([
    readJson<SectionState>(brief, tools, "section_state"),
    readJson<RedoRequest>(brief, tools, "redo_sections"),
    followsNewDraft(deps, brief),
  ]);
  const state = afterDraft
    ? stateForNewDraft(redo)
    : (remembered ?? emptySectionState());

  return { state, redo };
}

/** Every section pending again, and the gate's last redo request taken as handled: both named sections of the spec the draft replaced. */
function stateForNewDraft(lastRedo: RedoRequest | null): SectionState {
  return { ...emptySectionState(), redoRound: lastRedo?.round ?? 0 };
}

/** The draft wrote a new spec, so what the run remembers of its sections, and the gate's last redo request, belong to a spec that is gone. */
async function followsNewDraft(
  deps: Pick<CoverageDeps, "visitsOf">,
  brief: Brief,
): Promise<boolean> {
  const visits = await deps.visitsOf(brief.visitId);

  return visits.at(-2)?.nodeId === "draft";
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
  return defineStation("split-sections", splitSectionsHandle(coverageDeps));
}
