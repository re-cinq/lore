"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog, {
  toneClass,
  type ConfirmQuestion,
} from "./ConfirmDialog";
import { FormError } from "./FormError";

type ServerAction = () => Promise<{ error?: string }>;

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
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      const result = await action();

      setAsking(false);
      setError(result.error);

      if (!result.error) {
        router.refresh();
      }
    });

  return { asking, setAsking, error, pending, confirm };
}
