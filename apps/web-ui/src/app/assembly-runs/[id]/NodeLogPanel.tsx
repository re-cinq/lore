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
  view: { showRaw: boolean; entries: LogEntry[] },
): ReactNode {
  if (!resp?.logs) {
    return "(no output yet)";
  }

  return view.showRaw ? resp.logs : <LogEntriesView entries={view.entries} />;
}

interface NodeLogBodyProps {
  open: boolean;
  error: string | null;
  resp: NodeLogsResponse | null;
  showRaw: boolean;
  setShowRaw: (raw: boolean) => void;
  entries: LogEntry[];
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

function LogPlaceholder({ children }: { children: ReactNode }) {
  return <p className={`meta ${styles.placeholder}`}>{children}</p>;
}

/** What to show INSTEAD of logs, or null when there are logs to show. A closed card renders nothing at all — not even a placeholder — because the fetch has not been asked for yet, and "Loading…" under a collapsed header would claim work nobody started. */
function logNotice(notice: Pick<NodeLogBodyProps, "open" | "error" | "resp">) {
  const { open, error, resp } = notice;

  if (error) {
    return <p className={styles.error}>Failed to load logs: {error}</p>;
  }

  if (resp === null) {
    return open ? <LogPlaceholder>Loading…</LogPlaceholder> : null;
  }

  if (!resp.available) {
    return <LogPlaceholder>{unavailableMessage(resp.reason)}</LogPlaceholder>;
  }

  return null;
}

function LogToggleRow({
  showRaw,
  setShowRaw,
}: Pick<NodeLogBodyProps, "showRaw" | "setShowRaw">) {
  return (
    <div className={styles.toggleRow}>
      <LogFormatToggle
        raw={showRaw}
        onFormatted={() => setShowRaw(false)}
        onRaw={() => setShowRaw(true)}
      />
    </div>
  );
}

function LogTerminal({
  resp,
  showRaw,
  entries,
  bottomRef,
}: Omit<NodeLogBodyProps, "open" | "error" | "setShowRaw">) {
  return (
    <div className={styles.terminal}>
      {logContent(resp, { showRaw, entries })}
      <div ref={bottomRef} />
    </div>
  );
}

/** Everything below the collapsible header: error, unavailable notice, format toggle, and the log body itself. */
function NodeLogBody(props: NodeLogBodyProps) {
  const { error, resp } = props;

  // Null from logNotice means "a closed card shows nothing", NOT "show the logs" — so the fall-through is keyed on the response being available, not on the notice being absent.
  if (error !== null || resp === null || !resp.available) {
    return logNotice(props);
  }

  return (
    <>
      {resp.logs && <LogToggleRow {...props} />}
      <LogTerminal {...props} />
    </>
  );
}

// One collapsible live-log panel for one node's pod, read on-demand; older runs fall back to retained Cloud Logging.
/** The logs, or the message to show instead. A 403 is an ANSWER — the reader lacks access to the repo — so it comes back as text rather than as a thrown error. */
async function readNodeLogs(
  assemblyLineId: string,
  agentCrName: string,
): Promise<NodeLogsResponse | string> {
  try {
    const res = await fetch(nodeLogsUrl(assemblyLineId, agentCrName), {
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 403) {
      return "Access denied — you do not have access to this repository.";
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return (await res.json()) as NodeLogsResponse;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface LogFetchingOptions {
  open: boolean;
  resp: NodeLogsResponse | null;
  error: string | null;
  fetchLogs: () => Promise<void>;
}

/** Fetches once on first open, then polls only while the pod is still running. A finished pod's logs never change, so the poll stops rather than asking the same question forever. */
function useLogFetching({
  open,
  resp,
  error,
  fetchLogs,
}: LogFetchingOptions): void {
  useEffect(() => {
    if (open && resp === null && error === null) {
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
}

interface LogReaderOptions {
  assemblyLineId: string;
  agentCrName: string;
  setResp: (resp: NodeLogsResponse) => void;
  setError: (error: string | null) => void;
}

/** The one call that refreshes this node's logs, stable across renders so the poll interval is not torn down every tick. */
function useLogReader(options: LogReaderOptions) {
  const { assemblyLineId, agentCrName, setResp, setError } = options;

  return useCallback(async () => {
    const result = await readNodeLogs(assemblyLineId, agentCrName);

    // A string IS the answer here — readNodeLogs turns a 403 into a message rather than throwing.
    setError(typeof result === "string" ? result : null);

    if (typeof result !== "string") {
      setResp(result);
    }
  }, [assemblyLineId, agentCrName, setResp, setError]);
}

/** Follows the newest line as it arrives, the way a terminal does. */
function useScrollToTail(
  tailRef: React.RefObject<HTMLDivElement | null>,
  resp: NodeLogsResponse | null,
) {
  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [tailRef, resp]);
}

/** Keeps this node's logs current while the card is open: fetch on first open, poll while the pod is still running, and scroll to the newest line on every arrival. A 403 is stored as a MESSAGE rather than thrown — the reader lacks access to the repo, which is an answer, not a failure. */
function useNodeLogs(assemblyLineId: string, agentCrName: string) {
  const [open, setOpen] = useState(false); // eslint-disable-line re-lint/declare-near-use -- moving it down only pushes the sibling state past the same threshold
  const [resp, setResp] = useState<NodeLogsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => parseAgentLog(resp?.logs ?? ""), [resp?.logs]);
  const fetchLogs = useLogReader({
    assemblyLineId,
    agentCrName,
    setResp,
    setError,
  });

  useLogFetching({ open, resp, error, fetchLogs });
  useScrollToTail(tailRef, resp);

  return { open, setOpen, resp, error, showRaw, setShowRaw, entries, tailRef };
}

function nodeLogBodyProps(
  logs: ReturnType<typeof useNodeLogs>,
): NodeLogBodyProps {
  return {
    open: logs.open,
    error: logs.error,
    resp: logs.resp,
    showRaw: logs.showRaw,
    setShowRaw: logs.setShowRaw,
    entries: logs.entries,
    bottomRef: logs.tailRef,
  };
}

export default function NodeLogPanel(props: NodeLogPanelProps) {
  const { assemblyLineId, agentCrName, label } = props;
  const logs = useNodeLogs(assemblyLineId, agentCrName);
  const { resp } = logs;

  return (
    <CollapsibleCard
      title={label}
      labels={[resp?.phase, resp?.archived ? "retained" : null]}
      onToggle={logs.setOpen}
    >
      <NodeLogBody {...nodeLogBodyProps(logs)} />
    </CollapsibleCard>
  );
}
