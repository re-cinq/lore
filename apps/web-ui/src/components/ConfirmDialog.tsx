"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./ConfirmDialog.module.scss";

/** What a confirmation asks, and how loudly its confirm button says it. */
export interface ConfirmQuestion {
  title: string;
  body: string;
  confirmLabel: string;
  tone: "danger" | "accent";
  /** A name the person must type before confirm turns on, so a stray click cannot confirm. */
  typeToConfirm?: string;
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
  const typedName = useTypedName(props.question.typeToConfirm);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={props.onCancel}
    >
      <h2 id={titleId}>{props.question.title}</h2>
      <p className="meta">{props.question.body}</p>
      {props.question.typeToConfirm !== undefined && (
        <TypedName name={props.question.typeToConfirm} {...typedName} />
      )}
      <DialogActions {...props} confirmable={typedName.confirmable} />
    </dialog>
  );
}

function TypedName(props: {
  name: string;
  typed: string;
  onType: (typed: string) => void;
}) {
  return (
    <label className={styles.typedName}>
      Type <strong>{props.name}</strong> to confirm
      <input
        type="text"
        value={props.typed}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => props.onType(event.target.value)}
      />
    </label>
  );
}

type DialogActionsProps = ConfirmDialogProps & { confirmable: boolean };

function DialogActions(props: DialogActionsProps) {
  return (
    <div className={styles.actions}>
      <button type="button" className="btn-secondary" onClick={props.onCancel}>
        Cancel
      </button>
      <ConfirmButton {...props} />
    </div>
  );
}

function ConfirmButton({
  question,
  pending,
  confirmable,
  onConfirm,
}: DialogActionsProps) {
  return (
    <button
      type="button"
      className={toneClass(question.tone)}
      disabled={pending || !confirmable}
      onClick={onConfirm}
    >
      {question.confirmLabel}
    </button>
  );
}

export function toneClass(tone: ConfirmQuestion["tone"]): string | undefined {
  return tone === "danger" ? "danger" : undefined;
}

function useTypedName(typeToConfirm: string | undefined) {
  const [typed, onType] = useState("");
  const confirmable = [undefined, typed].includes(typeToConfirm);

  return { typed, onType, confirmable };
}

function useModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return dialogRef;
}
