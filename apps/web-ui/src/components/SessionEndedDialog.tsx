"use client";

import { useId } from "react";
import type { SessionEnd } from "@/lib/session-expiry";
import { useModal } from "./use-modal";
import dialogStyles from "./ConfirmDialog.module.scss";
import styles from "./SessionEndedDialog.module.scss";

interface SessionEndedDialogProps {
  end: SessionEnd;
  /** The session's length as the settings page words it, e.g. "8 hours". */
  lengthLabel: string;
  signInHref: string;
}

const CARRY_ON =
  "Sign in again to carry on; this page opens again where you were.";

/** Told over the whole page, because nothing on it works without a session. Escape does not close it: the only way on is to sign in. */
export default function SessionEndedDialog(props: SessionEndedDialogProps) {
  const dialogRef = useModal();
  const titleId = useId();

  return (
    <dialog
      ref={dialogRef}
      className={dialogStyles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => event.preventDefault()}
    >
      <h2 id={titleId}>Your session has ended</h2>
      <p className="meta">
        {whatHappened(props)} {CARRY_ON}
      </p>
      <SignInAgain href={props.signInHref} />
    </dialog>
  );
}

function SignInAgain({ href }: { href: string }) {
  return (
    <div className={dialogStyles.actions}>
      <a className={styles.signIn} href={href}>
        Sign in again
      </a>
    </div>
  );
}

function whatHappened({ end, lengthLabel }: SessionEndedDialogProps): string {
  return end === "timed-out"
    ? `Sign-ins last ${lengthLabel}, and yours has run out.`
    : "You have been signed out.";
}
