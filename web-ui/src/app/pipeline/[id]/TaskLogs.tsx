"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LogsResponse {
  logs: string | null;
  status: string;
  totalSize: number;
  error?: string;
}

const TERMINAL_STYLE: React.CSSProperties = {
  background: "#0d1117",
  color: "#c9d1d9",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "12px",
  lineHeight: "1.5",
  padding: "16px",
  borderRadius: "6px",
  overflowY: "auto",
  maxHeight: "500px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  border: "1px solid #30363d",
};

const HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "8px",
};

const PULSE_STYLE: React.CSSProperties = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: "#3fb950",
  display: "inline-block",
  animation: "pulse 1.5s ease-in-out infinite",
};

const ACTIVE_STATES = new Set(["running"]);
const POLL_INTERVAL_MS = 5_000;

export default function TaskLogs({ taskId, initialStatus }: { taskId: string; initialStatus: string }) {
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
      ? `/api/pipeline/${taskId}/logs?offset=${totalSize}`
      : `/api/pipeline/${taskId}/logs`;

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
    fetchLogs();
  }, [fetchLogs]);

  // Poll while running
  useEffect(() => {
    if (!ACTIVE_STATES.has(status) || accessDenied) return;
    const id = setInterval(fetchLogs, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchLogs, status, accessDenied]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const isRunning = ACTIVE_STATES.has(status);
  const isInReview = status === "review";
  const isDone = status === "succeeded" || status === "pr-created" || status === "merged";
  const isFailed = status === "failed" || status === "cancelled";

  return (
    <div style={{ marginTop: "24px" }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        Agent Output
        {isRunning && <span style={PULSE_STYLE} />}
        {isDone && <span className="op-badge op-pr-created" style={{ fontSize: "12px" }}>Completed</span>}
        {isInReview && <span className="op-badge op-running" style={{ fontSize: "12px" }}>In Review</span>}
        {isFailed && <span className="op-badge op-failed" style={{ fontSize: "12px" }}>Failed</span>}
      </h2>

      {accessDenied && (
        <p style={{ color: "#f87171", fontSize: "13px" }}>
          Access denied — you do not have access to this repository.
        </p>
      )}

      {error && !accessDenied && (
        <p style={{ color: "#f87171", fontSize: "13px" }}>Failed to load logs: {error}</p>
      )}

      {!accessDenied && logs === null && !error ? (
        <p className="meta" style={{ fontStyle: "italic" }}>
          Logs will appear when the agent starts.
        </p>
      ) : !accessDenied && logs !== null ? (
        <div style={TERMINAL_STYLE}>
          {logs}
          <div ref={bottomRef} />
        </div>
      ) : null}

      {isRunning && !accessDenied && (
        <p className="meta" style={{ marginTop: "6px", fontSize: "12px" }}>
          Polling every 5s{totalSize > 0 ? ` — ${(totalSize / 1024).toFixed(1)} KB received` : ""}
        </p>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
