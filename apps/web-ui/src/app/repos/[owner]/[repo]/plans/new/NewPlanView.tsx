"use client";

import { useActionState } from "react";
import { PLAN_KINDS } from "@re-cinq/planning-document";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";

type CreateAction = (
  prev: { error?: string } | null,
  formData: FormData,
) => Promise<{ error?: string }>;

export default function NewPlanView({ action }: { action: CreateAction }) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="task-form">
      <h2>Write a new plan</h2>
      <p className="meta">
        The plan opens as a shared document in its template. Anyone with access
        to this repo can write in it with you, and it ends when someone approves
        it.
      </p>
      <PlanFields />
      <FormError message={state?.error} />
      <SubmitButton pending={pending} pendingLabel="Creating the plan…">
        Create plan
      </SubmitButton>
    </form>
  );
}

/** Title and template are required; the description seeds the plan's intent. */
function PlanFields() {
  return (
    <>
      <label>
        Title
        <input name="title" required placeholder="Short name for the change" />
      </label>
      <TemplateField />
      <label>
        What you already know
        <textarea
          name="description"
          rows={6}
          placeholder="What should change, for whom, and why? It becomes the plan's intent."
        />
      </label>
    </>
  );
}

function TemplateField() {
  return (
    <label>
      Template
      <select name="type" defaultValue="feature">
        {PLAN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
    </label>
  );
}
