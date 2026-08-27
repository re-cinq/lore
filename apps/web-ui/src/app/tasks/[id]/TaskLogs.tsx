"use client";

// The task page's agent-output viewer, read from the turn-level transcript
// store through the /api/tasks/[id]/logs proxy (#1292 — the GCS byte log it
// replaced had no cluster-side writer left). Unlike the run page's one-shot
// FullTranscriptPanel walk, this polls: the row-id cursor persists across the
// coordinator's ticks, each fetch walking forward until a short page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseAgentLog } from "@/lib/agent-log-entries";
import { parseAgentRunTurn, type AgentRunTurn } from "@/lib/run-turn-types";
import {
  MAX_TURNS_LOADED,
  MAX_WALK_PAGES,
  parseHasMore,
  serverReportsMore,
} from "@/app/assembly-runs/[id]/turn-transcript-presenter";
import {
  advanceCursor,
  taskLogsUrl,
  walkContinues,
} from "./task-logs-presenter";
import { segmentLabel, segmentRawLog, segmentTurns } from "@/lib/turn-segments";
import LogEntriesView from "@/components/LogEntriesView";
import LogFormatToggle from "@/components/LogFormatToggle";
import { useCoordinatedRefresh } from "./TaskRefreshProvider";
import styles from "./TaskLogs.module.css";

const ACTIVE_STATES = new Set(["running"]);

export default function TaskLogs({
  taskId,
  initialStatus,
}: {
  taskId: string;
  initialStatus: string;
}) {
  const [turns, setTurns] = useState<AgentRunTurn[] | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  // Cursor and in-flight latch live in refs, not state: the coordinator can
  // tick while a walk is mid-flight, and two overlapping walks reading the
  // same cursor would append every row twice.
  const cursorRef = useRef("0");
  const loadedRef = useRef(0);
  const inFlightRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const segments = useMemo(
    () =>
      segmentTurns(turns ?? []).map((segment) => {
        const rawLog = segmentRawLog(segment);

        return {
          label: segmentLabel(segment),
          rawLog,
          entries: parseAgentLog(rawLog),
        };
      }),
    [turns],
  );
  const rawLog = useMemo(
    () => segments.map((segment) => segment.rawLog).join("\n"),
    [segments],
  );

  const fetchLogs = useCallback(async () => {
    // Don't keep polling if access was denied or the tab-memory cap is
    // already loaded, and never overlap a walk.
    if (
      accessDenied ||
      inFlightRef.current ||
      loadedRef.current >= MAX_TURNS_LOADED
    ) {
      return;
    }
    inFlightRef.current = true;

    try {
      let pages = 0;

      for (;;) {
        const res = await fetch(taskLogsUrl(taskId, cursorRef.current), {
          signal: AbortSignal.timeout(15_000),
        });

        // Read before the ok-check: the proxy stamps the header on
        // pass-through error responses too, and a Floor outage must not pin
        // a completed task on "running" (and its poll loop).
        const taskStatus = res.headers.get("X-Task-Status");

        if (taskStatus !== null) {
          setStatus(taskStatus);
        }

        if (res.status === 403) {
          setAccessDenied(true);
          setError(null);

          return;
        }

        if (res.status === 401) {
          setError("You must be signed in to view logs.");

          return;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const body = (await res.json()) as {
          turns?: unknown[];
          hasMore?: unknown;
        };
        const rows = Array.isArray(body.turns) ? body.turns : [];
        const parsed = rows
          .map(parseAgentRunTurn)
          .filter((turn): turn is AgentRunTurn => turn !== null);

        setTurns((prev) =>
          parsed.length > 0 ? [...(prev ?? []), ...parsed] : (prev ?? []),
        );
        pages += 1;
        loadedRef.current += parsed.length;
        const next = advanceCursor(rows, cursorRef.current);
        const progressed = next !== cursorRef.current;

        cursorRef.current = next;
        setError(null);

        // A page that cannot move the cursor would refetch itself forever, and
        // the per-walk page bound keeps a drifted Floor clamp from turning one
        // walk into a request storm — the persisted cursor lets the next
        // coordinator tick resume where this walk stopped. Whatever stopped
        // the walk, the cap notice shows exactly when the server still
        // reported more rows.
        const hasMoreFlag = parseHasMore(body);

        if (
          !progressed ||
          pages >= MAX_WALK_PAGES ||
          !walkContinues(rows, loadedRef.current, hasMoreFlag)
        ) {
          setCapped(serverReportsMore(rows, hasMoreFlag));

          return;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, [taskId, accessDenied]);

  const latestFetchLogs = useRef(fetchLogs);

  useEffect(() => {
    latestFetchLogs.current = fetchLogs;
  }, [fetchLogs]);

  // Initial fetch — once on mount; the ref keeps fetchLogs identity churn
  // (accessDenied updates) from re-firing this effect
  useEffect(() => {
    void latestFetchLogs.current();
  }, []);

  // Re-fetch on the page coordinator's ticks while running
  const { live } = useCoordinatedRefresh(
    fetchLogs,
    ACTIVE_STATES.has(status) && !accessDenied,
  );

  // Auto-scroll to bottom when new turns land
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const isRunning = ACTIVE_STATES.has(status);
  const isInReview = status === "review";
  const isDone =
    status === "succeeded" || status === "pr-created" || status === "merged";
  const isFailed = status === "failed" || status === "cancelled";
  // Anything past the not-yet-started and running phases is settled — this
  // must include statuses with no badge of their own (needs-human-help,
  // review), or their empty state would claim the agent has not started.
  const notStarted = status === "queued" || status === "pending";
  const finished = !notStarted && !isRunning;
  const hasTurns = turns !== null && turns.length > 0;
  const emptyAfterFinish = turns !== null && turns.length === 0 && finished;

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
        {hasTurns && !accessDenied && (
          <span className={styles.toggle}>
            <LogFormatToggle raw={showRaw} onChange={setShowRaw} />
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

      {!accessDenied && !error && !hasTurns && !emptyAfterFinish && (
        <p className={`meta ${styles.placeholder}`}>
          Logs will appear when the agent starts.
        </p>
      )}

      {!accessDenied && !error && emptyAfterFinish && (
        <p className={`meta ${styles.placeholder}`}>
          No stored agent turns for this task. Direct-API task types (onboard,
          feature-request) produce no transcript; locally-run tasks do not
          stream turns yet; and tasks predating the transcript store, or older
          than its 30-day retention, have none left.
        </p>
      )}

      {!accessDenied && hasTurns && (
        <div className={styles.terminal}>
          {showRaw
            ? rawLog
            : segments.map((segment, index) => (
                <section key={index} className={styles.segment}>
                  {segment.label !== null && (
                    <div className={styles.segmentLabel}>{segment.label}</div>
                  )}
                  <LogEntriesView entries={segment.entries} />
                </section>
              ))}
          <div ref={bottomRef} />
        </div>
      )}

      {capped && !accessDenied && (
        <p className={`meta ${styles.notice}`}>
          Loaded only the first {(turns ?? []).length} turns of this task.
        </p>
      )}

      {isRunning && !accessDenied && (
        <p className={`meta ${styles.polling}`}>
          {live ? "Live" : "Auto-refreshing"}
          {hasTurns ? ` — ${turns.length} turns received` : ""}
        </p>
      )}
    </div>
  );
}
