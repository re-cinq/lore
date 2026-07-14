"use client";

import { useState } from "react";

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
    <form
      action={`/api/tasks/${taskId}/cancel`}
      method="POST"
      style={{ display: "flex", gap: 10, alignItems: "center" }}
    >
      <span>Cancel this task?</span>
      <button type="submit" className="danger">
        Confirm cancel
      </button>
      <button type="button" onClick={() => setConfirming(false)}>
        Keep task
      </button>
    </form>
  );
}
