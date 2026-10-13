"use client";

import { useState } from "react";
import type { RefineAsk } from "@/lib/api/plans";
import type { PlanPageState } from "@/lib/plan-page-state";
import type { PlanActions } from "./plan-actions";

export interface RefineAsking {
  /** lore-api's reason for the last Refine it refused, until one is accepted or the page moves on. */
  refusal: string | null;
  /** The editor's `onRefine`: a refused ask rejects, so the editor withdraws it in every tab. */
  ask: (request: RefineAsk) => Promise<void>;
}

/** The plan editor's Refine and why lore-api last refused one; the panel outlives `router.refresh()`, so a new page state clears the reason. */
export function useRefineAsk(
  refine: PlanActions["refine"],
  state: PlanPageState,
): RefineAsking {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [refusedIn, setRefusedIn] = useState(state);

  if (refusedIn !== state) {
    setRefusedIn(state);
    setRefusal(null);
  }

  const ask = async (request: RefineAsk) => {
    const asked = await refine(request);

    setRefusal(asked.error ?? null);

    if (asked.error) {
      throw new Error(asked.error);
    }
  };

  return { refusal, ask };
}
