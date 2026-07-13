"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import GapSections, {
  emptyFeedback,
  toUserAnswers,
  type FeedbackState,
} from "./GapSections";
import RunningCard from "./RunningCard";
import FailureBlock from "./FailureBlock";
import { isPlanningActive } from "../feature-status";
import type {
  FeatureWithIterations,
  FeatureRow,
  FeatureIterationRow,
  SectionAnswers,
} from "@/lib/feature-types";

const POLL_MS = 4000;

// A planning round is genuinely in flight only while its task is in one of these
// non-terminal states; any other state means the round settled (ready or failed).
const RUNNING_TASK_STATUSES = new Set(["pending", "queued", "running"]);

interface Poll {
  feature: FeatureRow;
  latestIteration: FeatureIterationRow | null;
  task?: { status: string; failure_reason: string | null } | null;
  liveOutput?: string | null;
  /** Most recent iteration that produced a result — shown even if the latest round failed. */
  lastReady?: FeatureIterationRow | null;
}

export default function PlanningWizard({
  owner,
  repo,
  feature,
  timeoutMinutes,
  refine,
  finalize,
  onCreateDraft,
}: {
  owner: string;
  repo: string;
  feature: FeatureWithIterations;
  timeoutMinutes: number;
  refine: (userAnswers: SectionAnswers) => Promise<void>;
  finalize: () => Promise<void>;
  onCreateDraft: (title: string, prompt: string) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<Poll>({
    feature,
    latestIteration: feature.iterations[feature.iterations.length - 1] ?? null,
  });
  const [feedback, setFeedback] = useState<FeedbackState>(emptyFeedback());
  const [pending, startTransition] = useTransition();
  const [finalizing, setFinalizing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLatest = useCallback(async (): Promise<Poll | null> => {
    const r = await fetch(
      `/api/repos/${owner}/${repo}/features/${feature.id}`,
      { cache: "no-store" },
    );
    if (!r.ok) return null;
    try {
      const json = (await r.json()) as Poll;
      setData(json);
      return json;
    } catch {
      return null;
    }
  }, [owner, repo, feature.id]);

  const latest = data.latestIteration;
  const task = data.task;
  // The round settled but produced nothing usable (failed, or stuck 'running' with no
  // gap_result after the task ended) — the user must see it + retry, never an endless spinner.
  const taskActive = !task || RUNNING_TASK_STATUSES.has(task.status);
  const latestReady = latest?.status === "ready" && !!latest.gap_result;
  const failed =
    task?.status === "failed" ||
    latest?.status === "failed" ||
    (!latestReady && !taskActive);
  const running = (!latest || latest.status === "running") && !failed;

  useEffect(() => {
    if (!running) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    fetchLatest();
    timer.current = setInterval(fetchLatest, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running, fetchLatest]);

  const submitRefine = () =>
    startTransition(async () => {
      await refine(toUserAnswers(feedback));
      setFeedback(emptyFeedback());
      await fetchLatest();
    });

  const submitFinalize = () =>
    startTransition(async () => {
      setFinalizing(true);
      await finalize();
      await fetchLatest();
    });

  // After finalize, the feature-finalize task runs async (no intermediate status). Poll
  // until the feature leaves the planning phase (→ pr-open), then refresh the server
  // component so the parent swaps the wizard for the FinalizedView.
  useEffect(() => {
    if (!finalizing) return;
    const tick = async () => {
      const json = await fetchLatest();
      if (json && !isPlanningActive(json.feature.status)) router.refresh();
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [finalizing, fetchLatest, router]);

  const iteration = latest?.iteration ?? data.feature.current_iteration;

  if (running) {
    return (
      <RunningCard
        iteration={iteration}
        since={latest?.created_at}
        timeoutMinutes={timeoutMinutes}
        liveOutput={data.liveOutput}
      />
    );
  }

  // The analysis to show: the latest round's result, else the most recent round that
  // produced one (so a failed refine doesn't hide your prior analysis).
  const gap = latestReady
    ? latest?.gap_result
    : (data.lastReady?.gap_result ?? null);

  const failureBlock = (
    <FailureBlock
      iteration={iteration}
      failureReason={data.task?.failure_reason}
      pending={pending}
      onRetry={submitRefine}
    />
  );

  // No analysis ever produced: pure failure (if the latest failed) or an empty state.
  if (!gap) {
    return failed ? (
      failureBlock
    ) : (
      <div className="spec-card">
        <p className="meta">
          Planning hasn&apos;t produced an analysis yet — it will appear here
          once the first round finishes.
        </p>
      </div>
    );
  }

  // We have an analysis to work with. If the latest round failed, show the failure
  // banner above the preserved sections so the user can fix + retry without losing it.
  return (
    <div>
      {failed && <div style={{ marginBottom: 12 }}>{failureBlock}</div>}
      <GapSections
        gap={gap}
        feedback={feedback}
        onChange={setFeedback}
        onCreateDraft={onCreateDraft}
      />
      {finalizing && (
        <p className="meta" role="status">
          Finalizing — creating the spec PR…
        </p>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button
          type="button"
          disabled={pending || finalizing}
          onClick={submitRefine}
        >
          {pending ? "Working…" : "Refine again"}
        </button>
        <button
          type="button"
          className="button"
          disabled={pending || finalizing}
          onClick={submitFinalize}
        >
          {finalizing ? "Finalizing…" : "Proceed & finalize"}
        </button>
      </div>
    </div>
  );
}
