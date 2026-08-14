"use client";

import { useActionState } from "react";
import styles from "./SmartFeatureCreateView.module.scss";
import { FeatureAssemblyLine } from "@/components/FeatureAssemblyLine";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";

type CreateAction = (
  prev: { error?: string } | null,
  formData: FormData,
) => Promise<{ error?: string }>;

export default function SmartFeatureCreateView({
  action,
  definition = null,
}: {
  action: CreateAction;
  definition?: AssemblyLineDefinition | null;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={`task-form ${styles.form}`}>
      <h2>Plan a new feature</h2>

      <FeatureAssemblyLine definition={definition} />
      <p className="meta">
        Describe what you want. A planning Station analyzes it against this
        project and returns a gap-closing analysis you can refine before a spec
        PR is opened.
      </p>
      <label>
        Title
        <input name="title" required placeholder="Short feature name" />
      </label>
      <label>
        Describe the feature
        <textarea
          name="prompt"
          rows={6}
          required
          placeholder="What should it do, for whom, and why?"
        />
      </label>
      <FormError message={state?.error} />
      <SubmitButton pending={pending} pendingLabel="Starting planning…">
        Start planning
      </SubmitButton>
    </form>
  );
}
