"use client";

import { useState } from "react";
import type { PlanStory } from "@/lib/api/plans";
import PlanStoryDialog from "./PlanStoryDialog";

type Outcome = Promise<{ error?: string }>;

interface PlanStoryMenuItemProps {
  repo: string;
  story: PlanStory | null;
  save: (text: string) => Outcome;
  remove: () => Outcome;
}

/** The actions menu's User story item. Its popup is rendered inside the menu's panel, which the menu does not dismiss for a press or Escape inside a dialog. */
export default function PlanStoryMenuItem(props: PlanStoryMenuItemProps) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setAsking(true)}
      >
        User story…
      </button>
      {asking && (
        <PlanStoryDialog {...props} onClose={() => setAsking(false)} />
      )}
    </>
  );
}
