// Hands the spec writer one plan section per visit, in line order, and reports `done` when none are left; the bag's `done_sections` is the only memory, so the floor needs no fan-out (see specs/7-feature-planning/spec.md).

import {
  defineStation,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import type { CitablePlan } from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import { nextSection } from "@re-cinq/lore-shared/feature-planning/spec-sections.js";

export function splitSectionsHandle(): Handle {
  return async (_brief, tools) => {
    const [plan, done] = await Promise.all([
      readJson<CitablePlan>(tools, "plan_blocks"),
      readJson<string[]>(tools, "done_sections"),
    ]);
    const section = nextSection(plan, done ?? []);

    if (section === null) {
      return { outcome: "done" };
    }

    await tools.produce("current_section", section.text);
    await tools.produce("done_sections", JSON.stringify(section.done));

    return { outcome: "more" };
  };
}

async function readJson<T>(tools: Tools, need: string): Promise<T | null> {
  const text = (await tools.read(need)).toString("utf8");

  return text === "" ? null : (JSON.parse(text) as T);
}

export function startSplitSectionsStation(): RunningStation {
  return defineStation("split-sections", splitSectionsHandle());
}
