"use client";

import { useEffect, useId, useRef } from "react";
import styles from "./ConfirmDialog.module.scss";

/** What a confirmation asks, and how loudly its confirm button says it. */
export interface ConfirmQuestion {
  title: string;
  body: string;
  confirmLabel: string;
  tone: "danger" | "accent";
}

interface ConfirmDialogProps {
  question: ConfirmQuestion;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A modal that asks before an action that cannot be taken back. Mounted only while asking, so the caller owns whether it is open; Escape cancels. */
export default function ConfirmDialog(props: ConfirmDialogProps) {
  const dialogRef = useModal();
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={props.onCancel}
    >
      <h2 id={titleId}>{props.question.title}</h2>
      <p className="meta">{props.question.body}</p>
      <DialogActions {...props} />
    </dialog>
  );
}

function DialogActions(props: ConfirmDialogProps) {
  return (
    <div className={styles.actions}>
      <button type="button" className="btn-secondary" onClick={props.onCancel}>
        Cancel
      </button>
      <ConfirmButton {...props} />
    </div>
  );
}

function ConfirmButton({ question, pending, onConfirm }: ConfirmDialogProps) {
  return (
    <button
      type="button"
      className={toneClass(question.tone)}
      disabled={pending}
      onClick={onConfirm}
    >
      {question.confirmLabel}
    </button>
  );
}

export function toneClass(tone: ConfirmQuestion["tone"]): string | undefined {
  return tone === "danger" ? "danger" : undefined;
}

function useModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return dialogRef;
}
