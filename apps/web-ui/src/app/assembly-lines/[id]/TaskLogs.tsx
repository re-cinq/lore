"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./TaskLogs.module.css";

interface LogsResponse {
  logs: string | null;
  status: string;
  totalSize: number;
  error?: string;
}

const ACTIVE_STATES = new Set(["running"]);
const POLL_INTERVAL_MS = 5_000;

export default function TaskLogs({
  taskId,
  initialStatus,
}: {
  taskId: string;
  initialStatus: string;
}) {
  const [logs, setLogs] = useState<string | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [totalSize, setTotalSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    // Don't keep polling if access was denied
    if (accessDenied) return;

    const useOffset = totalSize > 0 && ACTIVE_STATES.has(status);
    const url = useOffset
      ? `/api/assembly-lines/${taskId}/logs?offset=${totalSize}`
      : `/api/assembly-lines/${taskId}/logs`;

    try {
      const res = await fetch(url);

      if (res.status === 403) {
        setAccessDenied(true);
        setError(null);
        return;
      }

      if (res.status === 401) {
        setError("You must be signed in to view logs.");
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: LogsResponse = await res.json();

      if (data.logs !== null) {
        if (useOffset && data.logs.length > 0) {
          // Append new content to existing logs
          setLogs((prev) => (prev ?? "") + data.logs);
        } else if (!useOffset) {
          // Full fetch — replace logs
          setLogs(data.logs);
        }
      }

      setStatus(data.status);
      setTotalSize(data.totalSize);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [taskId, status, totalSize, accessDenied]);

  // Initial fetch
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Poll while running
  useEffect(() => {
    if (!ACTIVE_STATES.has(status) || accessDenied) return;
    const id = setInterval(() => void fetchLogs(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchLogs, status, accessDenied]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const isRunning = ACTIVE_STATES.has(status);
  const isInReview = status === "review";
  const isDone =
    status === "succeeded" || status === "pr-created" || status === "merged";
  const isFailed = status === "failed" || status === "cancelled";

  return (
    <div className={styles.wrap}>
      <h2 className={styles.heading}>
        Agent Output
        {isRunning && <span className={styles.pulse} />}
        {isDone && (
          <span className={`op-badge op-pr-created ${styles.statusBadge}`}>
            Completed
          </span>
        )}
        {isInReview && (
          <span className={`op-badge op-running ${styles.statusBadge}`}>
            In Review
          </span>
        )}
        {isFailed && (
          <span className={`op-badge op-failed ${styles.statusBadge}`}>
            Failed
          </span>
        )}
      </h2>

      {accessDenied && (
        <p className={styles.error}>
          Access denied — you do not have access to this repository.
        </p>
      )}

      {error && !accessDenied && (
        <p className={styles.error}>Failed to load logs: {error}</p>
      )}

      {!accessDenied && logs === null && !error ? (
        <p className={`meta ${styles.placeholder}`}>
          Logs will appear when the agent starts.
        </p>
      ) : !accessDenied && logs !== null ? (
        <div className={styles.terminal}>
          {logs}
          <div ref={bottomRef} />
        </div>
      ) : null}

      {isRunning && !accessDenied && (
        <p className={`meta ${styles.polling}`}>
          Polling every 5s
          {totalSize > 0
            ? ` — ${(totalSize / 1024).toFixed(1)} KB received`
            : ""}
        </p>
      )}
    </div>
  );
}
