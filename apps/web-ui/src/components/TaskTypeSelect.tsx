"use client";

import { useState } from "react";

const DESCRIPTIONS: Record<string, string> = {
  "feature-request":
    "PM intent in plain language becomes a spec, plan, and tasks for review.",
  general: "Open-ended task with full Lore context.",
  runbook: "Generates an incident runbook.",
  implementation: "Implements from an existing spec file.",
  "gap-fill": "Drafts missing documentation.",
  review: "Reviews a PR against the repo conventions.",
  onboard: "Inspects the repo and generates its Lore scaffolding.",
};

export function TaskTypeSelect({
  options,
}: {
  options: { value: string; label: string }[];
}) {
  const [selected, setSelected] = useState(options[0]?.value ?? "");
  const description = DESCRIPTIONS[selected];
  return (
    <>
      <select
        name="task_type"
        id="task_type"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {description && <span className="meta">{description}</span>}
    </>
  );
}
