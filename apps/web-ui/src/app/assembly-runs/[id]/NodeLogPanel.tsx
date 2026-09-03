"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { parseAgentLog, type LogEntry } from "@/lib/agent-log-entries";
import CollapsibleCard from "@/components/CollapsibleCard";
import LogEntriesView from "@/components/LogEntriesView";
import LogFormatToggle from "@/components/LogFormatToggle";
import {
  nodeLogsUrl,
  shouldPollNode,
  unavailableMessage,
  type NodeLogsResponse,
} from "./node-pod-logs-presenter";
import styles from "./NodeLogPanel.module.css";

const POLL_INTERVAL_MS = 5_000;

export interface NodeLogPanelProps {
  assemblyLineId: string;
  agentCrName: string;
  label: string;
}

function logContent(
  resp: NodeLogsResponse | null,
  showRaw: boolean,
  entries: LogEntry[],
): ReactNode {
  if (!resp?.logs) {
    return "(no output yet)";
  }

  return showRaw ? resp.logs : <LogEntriesView entries={entries} />;
}

/** Everything below the collapsible header: error, unavailable notice, format toggle, and the log body itself. */
function NodeLogBody({
  open,
  error,
  resp,
  showRaw,
  onShowRawChange,
  entries,
  bottomRef,
}: {
  open: boolean;
  error: string | null;
  resp: NodeLogsResponse | null;
  showRaw: boolean;
  onShowRawChange: (raw: boolean) => void;
  entries: LogEntry[];
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (error) {
    return <p className={styles.error}>Failed to load logs: {error}</p>;
  }

  if (resp === null) {
    return open ? (
      <p className={`meta ${styles.placeholder}`}>Loading…</p>
    ) : null;
  }

  if (!resp.available) {
    return (
      <p className={`meta ${styles.placeholder}`}>
        {unavailableMessage(resp.reason)}
      </p>
    );
  }

  return (
    <>
      {resp.logs && (
        <div className={styles.toggleRow}>
          <LogFormatToggle raw={showRaw} onChange={onShowRawChange} />
        </div>
      )}
      <div className={styles.terminal}>
        {logContent(resp, showRaw, entries)}
        <div ref={bottomRef} />
      </div>
    </>
  );
}

// One collapsible live-log panel for one node's pod, read on-demand; older runs fall back to retained Cloud Logging.
export default function NodeLogPanel({
  assemblyLineId,
  agentCrName,
  label,
}: NodeLogPanelProps) {
  const [open, setOpen] = useState(false);
  const [resp, setResp] = useState<NodeLogsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => parseAgentLog(resp?.logs ?? ""), [resp?.logs]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(nodeLogsUrl(assemblyLineId, agentCrName), {
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 403) {
        setError("Access denied — you do not have access to this repository.");

        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setResp((await res.json()) as NodeLogsResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [assemblyLineId, agentCrName]);

  useEffect(() => {
    if (open && resp === null && error === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on open; state is set inside the async fetch
      void fetchLogs();
    }
  }, [open, resp, error, fetchLogs]);

  useEffect(() => {
    if (!open || !shouldPollNode(resp)) {
      return;
    }
    const id = setInterval(() => void fetchLogs(), POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [open, resp, fetchLogs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [resp]);

  return (
    <CollapsibleCard
      title={label}
      labels={[resp?.phase, resp?.archived ? "retained" : null]}
      onToggle={setOpen}
    >
      <NodeLogBody
        open={open}
        error={error}
        resp={resp}
        showRaw={showRaw}
        onShowRawChange={setShowRaw}
        entries={entries}
        bottomRef={bottomRef}
      />
    </CollapsibleCard>
  );
}
