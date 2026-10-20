"use client";

import { useEffect, useId, useRef } from "react";
import Icon from "@/components/Icon";
import styles from "./ShellDialog.module.css";

interface ShellDialogProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** `wide` fits the glossary's prose; the default suits a short list. */
  size?: "default" | "wide";
}

/** A centred card over a blurred backdrop. Escape is the provider's to handle; the backdrop and the close button dismiss it here. */
export default function ShellDialog(props: ShellDialogProps) {
  const { title, onClose, children, size = "default" } = props;
  const titleId = useId();
  const classes = `${styles.dialog} ${size === "wide" ? styles.wide : ""}`;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={classes}
      >
        <DialogHead titleId={titleId} title={title} onClose={onClose} />
        {children}
      </div>
    </>
  );
}

interface DialogHeadProps {
  titleId: string;
  title: string;
  onClose: () => void;
}

/** The title and the close pill, which takes focus as the dialog opens. */
function DialogHead({ titleId, title, onClose }: DialogHeadProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  return (
    <div className={styles.head}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <CloseButton buttonRef={closeRef} onClose={onClose} />
    </div>
  );
}

function CloseButton({
  buttonRef,
  onClose,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.close}
      onClick={onClose}
      aria-label="Close"
    >
      <Icon name="close" size={18} />
    </button>
  );
}
