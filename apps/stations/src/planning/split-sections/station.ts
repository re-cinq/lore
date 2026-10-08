// Hands the spec writer one plan section per visit and decides what each pod's returned result means: the pod reports, this station marks the section done (see specs/7-feature-planning/spec.md FR-24). It also takes the sections the gate sent back, so a fix redoes only those. The bag's `section_state` is its only memory, because the floor has no fan-out.

import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import type { CitablePlan } from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import {
  absorbRedo,
  emptySectionState,
  nextStep,
  sectionResultSchema,
  settle,
  type RedoRequest,
  type SectionResult,
  type SectionState,
  type Step,
} from "@re-cinq/lore-shared/feature-planning/spec-sections.js";

export function splitSectionsHandle(): Handle {
  return async (_brief, tools) => {
    const plan = await readJson<CitablePlan>(tools, "plan_blocks");

    if (plan === null) {
      return { outcome: "done" };
    }
    const step = await stepOf(tools, plan);

    await Promise.all([
      tools.produce("section_state", JSON.stringify(step.state)),
      tools.produce("current_section", step.text),
      // The bag never drops a key: without this, a pod that writes no result would be settled by the last one's.
      tools.produce("section_result", ""),
    ]);

    return { outcome: step.outcome };
  };
}

async function stepOf(tools: Tools, plan: CitablePlan): Promise<Step> {
  const [state, result, redo] = await Promise.all([
    readJson<SectionState>(tools, "section_state"),
    readResult(tools),
    readJson<RedoRequest>(tools, "redo_sections"),
  ]);
  const settled = settle(state ?? emptySectionState(), result);

  return nextStep(plan, absorbRedo(settled, redo));
}

async function readResult(tools: Tools): Promise<SectionResult | null> {
  const parsed = sectionResultSchema.safeParse(
    await readJson(tools, "section_result"),
  );

  return parsed.success ? parsed.data : null;
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
