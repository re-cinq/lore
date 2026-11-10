"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import type { SkillFormAction } from "./SkillForm";

export function DeleteSkillButton({ action }: { action: SkillFormAction }) {
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction}>
      <SubmitButton>Delete</SubmitButton>
      {state.error && <span role="alert">{state.error}</span>}
    </form>
  );
}
