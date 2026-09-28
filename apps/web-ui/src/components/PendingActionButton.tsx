"use client";

import { useState, type ReactNode } from "react";
import styles from "./PendingActionButton.module.css";

interface PendingActionButtonProps {
  action: () => Promise<void>;
  text: ReactNode;
  /** What the button says while the action runs — the only thing that differs between its instances. */
  pendingText: ReactNode;
  /** An outside pending signal (e.g. a confirm dialog's own in-flight request), OR'd with the button's own click. */
  pending?: boolean;
  disabled?: boolean;
  /** The button sits inside a clickable row — stop the click before it also fires the row's handler. */
  guardRow?: boolean;
  /** Overrides the default link-styled skin; pass "" for the plain global button. */
  className?: string;
  title?: string;
}

/** A server-action button that disables itself for the duration and says what it is doing. */
export default function PendingActionButton(props: PendingActionButtonProps) {
  const { pending, onClick } = usePendingClick(props);

  return (
    <button
      type="button"
      disabled={pending || (props.disabled ?? false)}
      className={props.className ?? styles.button}
      title={props.title}
      onClick={onClick}
    >
      <Label
        pending={pending}
        text={props.text}
        pendingText={props.pendingText}
      />
    </button>
  );
}

/** The button's own in-flight click, OR'd with an outside pending signal; the row guard lives in the same handler since both act on the same click. */
function usePendingClick({
  action,
  pending: externalPending,
  guardRow,
}: PendingActionButtonProps) {
  const [clickPending, setClickPending] = useState(false);

  function onClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (guardRow) {
      event.preventDefault();
      event.stopPropagation();
    }
    setClickPending(true);
    void action()
      .catch(() => {})
      .finally(() => setClickPending(false));
  }

  return { pending: clickPending || (externalPending ?? false), onClick };
}

function Label({
  pending,
  text,
  pendingText,
}: {
  pending: boolean;
  text: ReactNode;
  pendingText: ReactNode;
}) {
  if (!pending) {
    return text;
  }

  return (
    <>
      <span className={styles.spinner} aria-hidden="true" />
      {pendingText}
    </>
  );
}
