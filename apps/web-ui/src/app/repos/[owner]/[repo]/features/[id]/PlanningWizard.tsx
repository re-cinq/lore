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
import { isRewind, lineageLabel, rewindOptions } from "@/lib/round-picker";
import type { FeatureRunPayload } from "@/lib/feature-run";
import { specPhaseOf } from "@/lib/spec-phase";
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
  /** The round's assembly line, for the live run visualization. Absent until the
   *  first poll returns (and null when the round has no run row). */
  run?: FeatureRunPayload | null;
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
  refine: (
    userAnswers: SectionAnswers,
    fromIteration?: number,
  ) => Promise<void>;
  finalize: () => Promise<void>;
  onCreateDraft: (title: string, prompt: string) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<Poll>({
    feature,
    latestIteration: feature.iterations[feature.iterations.length - 1] ?? null,
  });
  const [feedback, setFeedback] = useState<FeedbackState>(emptyFeedback());
  /** Which round the next one continues from; undefined = the latest. */
  const [continueFrom, setContinueFrom] = useState<number | undefined>();
  const [pending, startTransition] = useTransition();
  const [finalizing, setFinalizing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Iteration whose completion already triggered a server refresh. */
  const refreshedFor = useRef<number | null>(null);

  const fetchLatest = useCallback(async (): Promise<Poll | null> => {
    const r = await fetch(
      `/api/repos/${owner}/${repo}/features/${feature.id}`,
      { cache: "no-store" },
    );

    if (!r.ok) {
      return null;
    }

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
  const settledUnusable = !latestReady && !taskActive;
  const failed =
    task?.status === "failed" || latest?.status === "failed" || settledUnusable;
  const running = (!latest || latest.status === "running") && !failed;

  useEffect(() => {
    if (!running) {
      if (timer.current) {
        clearInterval(timer.current);
      }

      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount; state is set inside the async fetch
    void fetchLatest();
    timer.current = setInterval(() => void fetchLatest(), POLL_MS);

    return () => {
      if (timer.current) {
        clearInterval(timer.current);
      }
    };
  }, [running, fetchLatest]);

  // The poll updates THIS component, but the draft spec renders from the server's
  // copy of the feature (FeatureDetailView reads feature.draft_spec_md). Without a
  // refresh, a round that just landed leaves the page showing pre-round data until
  // the reader thinks to reload. Once per iteration — refresh() re-renders the
  // parent, which would otherwise re-trigger this on every poll.
  useEffect(() => {
    if (!latestReady || refreshedFor.current === latest?.iteration) {
      return;
    }

    refreshedFor.current = latest?.iteration ?? null;
    router.refresh();
  }, [latestReady, latest?.iteration, router]);

  // From the server-rendered feature, refreshed by router.refresh() when a round
  // lands — the poll payload carries only the latest iteration, not the history.
  const rounds = rewindOptions(feature.iterations);
  const rewinding = isRewind(rounds, continueFrom);

  const submitRefine = () =>
    startTransition(async () => {
      await refine(toUserAnswers(feedback), continueFrom);
      setFeedback(emptyFeedback());
      setContinueFrom(undefined);
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
    if (!finalizing) {
      return;
    }
    const tick = async () => {
      const json = await fetchLatest();

      if (json && !isPlanningActive(json.feature.status)) {
        router.refresh();
      }
    };
    const id = setInterval(() => void tick(), POLL_MS);

    return () => clearInterval(id);
  }, [finalizing, fetchLatest, router]);

  const iteration = latest?.iteration ?? data.feature.current_iteration;

  // The spec phase gets the SAME card as a planning round: it runs on the same line,
  // and the author has no decision to make while it does. Showing the decision row
  // with everything disabled — a greyed "Refine again" beside a primary relabelled
  // "Creating the spec PR…" — offered two dead controls and hid the run graph, which
  // only ever rendered here.
  // Read from the LINE, not from "did the author just press the button": a line that
  // finishes without producing a PR must give the controls back rather than leave a
  // progress card running forever. `finalizing` only bridges the gap until the first
  // poll shows the line moving, and never survives it finishing.
  const spec = specPhaseOf(data.run);
  const showSpec =
    spec.running ||
    (finalizing && (data.run?.status ?? "running") === "running");

  if (running || showSpec) {
    return (
      <RunningCard
        iteration={iteration}
        since={running ? latest?.created_at : spec.since}
        timeoutMinutes={timeoutMinutes}
        liveOutput={data.liveOutput}
        run={data.run}
        phase={running ? "round" : "spec"}
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
      answers={latest?.user_answers}
      run={data.run}
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
      <div
        style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}
      >
        <button type="button" disabled={pending} onClick={submitRefine}>
          {pending ? "Working…" : "Refine again"}
        </button>
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={submitFinalize}
        >
          Create the spec PR
        </button>
        {rounds.length > 1 && (
          <label className="meta" style={{ marginLeft: "auto" }}>
            Continue from{" "}
            <select
              value={continueFrom ?? rounds[0].iteration}
              disabled={pending}
              onChange={(e) => setContinueFrom(Number(e.target.value))}
            >
              {rounds.map((r) => (
                <option key={r.iteration} value={r.iteration}>
                  {lineageLabel(r)
                    ? `${r.label} — ${lineageLabel(r)}`
                    : r.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {rewinding && (
        <p className="meta" role="status" style={{ marginTop: 6 }}>
          This round continues round {continueFrom} — rounds after it stay on
          record but are not carried forward.
        </p>
      )}
    </div>
  );
}
