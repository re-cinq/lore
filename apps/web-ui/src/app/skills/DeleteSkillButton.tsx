"use client";

import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { ServerAction } from "@/components/useRefreshingAction";

interface DeleteSkillButtonProps {
  name: string;
  remove: ServerAction;
}

export function DeleteSkillButton({ name, remove }: DeleteSkillButtonProps) {
  return (
    <ConfirmedActionButton
      action={remove}
      label="Delete"
      question={{
        title: `Delete ${name}?`,
        body: "The org skill is removed and agents stop receiving it. This cannot be undone.",
        confirmLabel: "Delete skill",
        tone: "danger",
        typeToConfirm: name,
      }}
    />
  );
}
