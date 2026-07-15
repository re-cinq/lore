"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  nodeLogsUrl,
  shouldPollNode,
  unavailableMessage,
  type NodeLogsResponse,
} from "./node-pod-logs-presenter";
import styles from "./NodePodLogs.module.css";

const POLL_INTERVAL_MS = 5_000;

export interface NodeLogTarget {
  nodeId: string;
  agentCrName: string;
}

/** One collapsible live-log panel per node (its Agent CR's pod). Logs are read
 *  on-demand from the cluster and vanish when the pod is cleaned up. */
export default function NodePodLogs({
  assemblyLineId,
  nodes,
}: {
  assemblyLineId: string;
  nodes: NodeLogTarget[];
}) {
  if (nodes.length === 0) {
    return null;
  }

  return (
    <section className={styles.wrap}>
      <h2>Pod logs</h2>
      <p className="meta">
        Live per-node output, read from the cluster. Logs are not retained —
        once a node's pod is cleaned up they are no longer available.
      </p>
      {nodes.map((node) => (
        <NodeLogPanel
          key={node.agentCrName}
          assemblyLineId={assemblyLineId}
          node={node}
        />
      ))}
    </section>
  );
}

function NodeLogPanel({
  assemblyLineId,
  node,
}: {
  assemblyLineId: string;
  node: NodeLogTarget;
}) {
  const [open, setOpen] = useState(false);
  const [resp, setResp] = useState<NodeLogsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(nodeLogsUrl(assemblyLineId, node.agentCrName));

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
  }, [assemblyLineId, node.agentCrName]);

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
    <details
      className={styles.panel}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className={styles.summary}>
        <span className={styles.mono}>{node.nodeId}</span>
        {resp?.phase && <span className="meta"> · {resp.phase}</span>}
      </summary>

      {error && <p className={styles.error}>Failed to load logs: {error}</p>}

      {!error && resp && !resp.available && (
        <p className={`meta ${styles.placeholder}`}>
          {unavailableMessage(resp.reason)}
        </p>
      )}

      {!error && resp?.available && (
        <div className={styles.terminal}>
          {resp.logs || "(no output yet)"}
          <div ref={bottomRef} />
        </div>
      )}

      {!error && open && resp === null && (
        <p className={`meta ${styles.placeholder}`}>Loading…</p>
      )}
    </details>
  );
}
