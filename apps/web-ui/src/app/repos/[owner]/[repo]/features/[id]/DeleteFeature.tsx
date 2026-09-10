"use client";

import { useState } from "react";
import styles from "./FeatureDetailView.module.scss";
import { DangerZone } from "@/components/DangerZone";
import { SubmitButton } from "@/components/SubmitButton";

interface ConfirmDeleteRowProps {
  title: string;
  pending: boolean;
  onDelete: () => void;
  onCancel: () => void;
}

interface DeleteFeatureProps {
  title: string;
  pending: boolean;
  onDelete: () => void;
}

/** Two-step by design: a feature carries every planning round it ever ran, and none of that comes back. */
export default function DeleteFeature(props: DeleteFeatureProps) {
  const { title, pending, onDelete } = props;
  const [confirming, setConfirming] = useState(false);
  const openConfirm = () => setConfirming(true);

  return (
    <DangerZone description="Permanently delete this feature and all its planning rounds. This cannot be undone.">
      {confirming ? (
        <ConfirmDeleteRow
          title={title}
          pending={pending}
          onDelete={onDelete}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <OpenConfirmButton pending={pending} onClick={openConfirm} />
      )}
    </DangerZone>
  );
}

/** The confirm step, naming the feature. The title is repeated back because the button that opened this row sits below a page that may have scrolled away from it. */
function ConfirmDeleteRow(props: ConfirmDeleteRowProps) {
  const { title, pending, onDelete, onCancel } = props;

  return (
    <div className={styles.confirmRow}>
      <span>Delete &ldquo;{title}&rdquo; and all its rounds?</span>
      <ConfirmDeleteButton pending={pending} onClick={onDelete} />
      <SubmitButton type="button" onClick={onCancel} pending={pending}>
        Cancel
      </SubmitButton>
    </div>
  );
}

/** The button that actually deletes, kept apart from the one that only opens the confirm row so the two are never mistaken for each other. */
function ConfirmDeleteButton({
  pending,
  onClick,
}: {
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <SubmitButton
      type="button"
      className="danger"
      onClick={onClick}
      pending={pending}
      pendingLabel="Deleting…"
    >
      Confirm delete
    </SubmitButton>
  );
}

/** The first step: it only opens the confirm row, so it deletes nothing on its own. */
function OpenConfirmButton({
  pending,
  onClick,
}: {
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <SubmitButton
      type="button"
      className="danger"
      onClick={onClick}
      pending={pending}
    >
      Delete feature
    </SubmitButton>
  );
}
