"use client";

import { useState } from "react";
import styles from "./CancelTaskButton.module.scss";

export function CancelTaskButton({ taskId }: { taskId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="danger"
        onClick={() => setConfirming(true)}
      >
        Cancel Task
      </button>
    );
  }

  return (
    <CancelConfirmForm taskId={taskId} onKeep={() => setConfirming(false)} />
  );
}

interface CancelConfirmFormProps {
  taskId: string;
  onKeep: () => void;
}

function CancelConfirmForm({ taskId, onKeep }: CancelConfirmFormProps) {
  return (
    <form
      action={`/api/tasks/${taskId}/cancel`}
      method="POST"
      className={styles.confirm}
    >
      <span>Cancel this task?</span>
      {/* eslint-disable-next-line no-restricted-syntax -- native full-page POST, no client JS state to show; the browser's own navigation is the pending affordance */}
      <button type="submit" className="danger">
        Confirm cancel
      </button>
      <button type="button" onClick={onKeep}>
        Keep task
      </button>
    </form>
  );
}
