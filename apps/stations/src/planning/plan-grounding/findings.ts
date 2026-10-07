// A stale name in the PLAN, reported where the plan's people read it (specs/7-feature-planning FR-22).

import type { GroundedFile } from "@re-cinq/lore-shared/feature-planning/grounding.js";
import { djb2Hash } from "@re-cinq/lore-shared/llm/prompt-cache.js";
import { GROUND_PREFIX, type Finding } from "../plan-findings-ops.js";

const SLOT_MARKER = /<!--\s*slot:([^\s>]+?)\s*-->/;

/** The slot whose marker precedes this 1-based line, or none when no marker does. */
export function slotOfLine(planMd: string, line: number): string | null {
  const above = planMd.split("\n").slice(0, line);
  const markers = above.flatMap((text) => SLOT_MARKER.exec(text)?.[1] ?? []);

  return markers.at(-1) ?? null;
}

/** One finding per section and stale name: a name two statements of a section both carry is one thing to fix. */
export function planGroundFindings(
  planMd: string,
  grounded: GroundedFile,
): Finding[] {
  const byKey = new Map<string, Finding>();

  for (const found of grounded.findings) {
    const slot = slotOfLine(planMd, found.line);

    if (slot) {
      byKey.set(`${slot}\n${found.name}`, findingOf(slot, found));
    }
  }

  return [...byKey.values()];
}

type Grounded = GroundedFile["findings"][number];

function findingOf(slot: string, found: Grounded): Finding {
  return {
    slot,
    finding_id: `${GROUND_PREFIX}${djb2Hash(`${slot}\n${found.name}`)}`,
    text: textOf(found),
    why: whyOf(found),
    // A retired component is certainly gone; a path merely absent may be one this plan adds.
    severity: found.kind === "retired" ? "blocker" : "warning",
  };
}

function textOf(found: Grounded): string {
  return found.kind === "retired"
    ? `This section names \`${found.name}\`, which has been retired.`
    : `This section names \`${found.name}\`, which is not on the default branch.`;
}

function whyOf(found: Grounded): string {
  const where = `\`${found.name}\` is not on main`;
  const hint = found.hint ? ` ${found.hint}` : "";

  return `${where}, so a spec written from this section would describe code that does not exist.${hint} Rewrite the statement from the code as it stands, or say that this feature adds it.`;
}
