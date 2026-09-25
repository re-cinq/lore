"use client";

import { useState } from "react";
import ConfirmDialog, {
  toneClass,
  type ConfirmQuestion,
} from "./ConfirmDialog";
import { FormError } from "./FormError";
import { useRefreshingAction, type ServerAction } from "./useRefreshingAction";

interface ConfirmedActionButtonProps {
  action: ServerAction;
  label: string;
  question: ConfirmQuestion;
  /** What the action still waits on; while set, the button is off and says so in its tooltip. */
  waitingOn?: string;
}

/** A server action asked first in a modal, run once on confirm, and the page reloaded onto what it changed. */
export default function ConfirmedActionButton(
  props: ConfirmedActionButtonProps,
) {
  const confirmed = useConfirmedAction(props.action);

  return (
    <>
      <AskButton {...props} ask={() => confirmed.setAsking(true)} />
      <FormError message={confirmed.error} />
      {confirmed.asking && (
        <ConfirmDialog
          question={props.question}
          pending={confirmed.pending}
          onConfirm={confirmed.confirm}
          onCancel={() => confirmed.setAsking(false)}
        />
      )}
    </>
  );
}

function AskButton({
  label,
  question,
  waitingOn,
  ask,
}: ConfirmedActionButtonProps & { ask: () => void }) {
  return (
    <button
      type="button"
      className={toneClass(question.tone)}
      disabled={waitingOn !== undefined}
      title={waitingOn}
      onClick={ask}
    >
      {label}
    </button>
  );
}

function useConfirmedAction(action: ServerAction) {
  const [asking, setAsking] = useState(false);
  const { error, pending, run } = useRefreshingAction(action, () =>
    setAsking(false),
  );

  return { asking, setAsking, error, pending, confirm: run };
}
