"use client";

import { useState } from "react";
import PendingActionButton from "@/components/PendingActionButton";
import styles from "./agents.module.css";

export interface RemoveOverrideButtonProps {
  /** Definition being dropped; named in the confirm line so the row is unambiguous. */
  name: string;
  /** The bound server action — the repo is applied server-side. */
  remove: () => Promise<void>;
}

/** Drops a per-repo agent override, restoring the org-wide default for that station. Confirmed rather than fired from one press — the repo's own prompt and model do not come back. */
export default function RemoveOverrideButton(props: RemoveOverrideButtonProps) {
  const { name, remove } = props;
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <ConfirmRow
        name={name}
        pending={pending}
        onConfirm={() => confirmedRemove(remove, setPending)}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return <ArmButton onClick={() => setConfirming(true)} />;
}

async function confirmedRemove(
  remove: () => Promise<void>,
  setPending: (pending: boolean) => void,
): Promise<void> {
  setPending(true);

  try {
    await remove();
  } finally {
    setPending(false);
  }
}

interface ConfirmRowProps {
  name: string;
  pending: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/** The second click. Removing the override is not undoable from this page: the repo's model, timeout and prompt are gone and the org default resolves in their place. Cancel is disabled off the same `pending` the confirm button drives, so it can't be clicked mid-remove. */
function ConfirmRow({ name, pending, onConfirm, onCancel }: ConfirmRowProps) {
  return (
    <div className={styles.confirmRow}>
      <span className={styles.detail}>
        Remove <strong>{name}</strong>? The org default applies again.
      </span>
      <PendingActionButton
        action={onConfirm}
        text="Confirm remove"
        pendingText="Removing…"
        className="danger"
      />
      <button className="btn-secondary" disabled={pending} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** The first click. Arms the confirmation rather than removing anything. */
function ArmButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-secondary" onClick={onClick}>
      Remove
    </button>
  );
}
