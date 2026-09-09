"use client";

// The per-file diff drawer (specs/assembly-line-run-viz FR8.6): fetches the run's PR files once per mount and shows the one the heatmap bar named.
import { useEffect, useRef, useState } from "react";
import CollapsibleCard from "@/components/CollapsibleCard";
import type { PullFileChange, PullFiles } from "@/lib/api/pull-files";
import { diffViewModel, matchChangedFile } from "@/lib/pull-file-diff";
import DiffView from "./DiffView";

export interface FileDiffDrawerProps {
  runId: string;
  path: string | null;
  prNumber: number | null;
  onClose: () => void;
}

type FilesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; files: readonly PullFileChange[] };

async function loadPullFiles(runId: string): Promise<FilesState> {
  const res = await fetch(`/api/assembly-runs/${runId}/pull-files`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };

    return { status: "error", message: body.error ?? `HTTP ${res.status}` };
  }
  const { files } = (await res.json()) as Partial<PullFiles>;

  return { status: "ready", files: files ?? [] };
}

function failed(err: unknown): FilesState {
  return {
    status: "error",
    message: err instanceof Error ? err.message : String(err),
  };
}

/** One fetch per run: the run id it was made for lives in a ref, so switching files re-reads nothing, and a drawer that is closed (no path) never fetches. */
function usePullFiles({
  runId,
  enabled,
}: {
  runId: string;
  enabled: boolean;
}): FilesState {
  const [state, setState] = useState<FilesState>({ status: "loading" });
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || loadedFor.current === runId) {
      return;
    }
    loadedFor.current = runId;
    void loadPullFiles(runId).catch(failed).then(setState);
  }, [runId, enabled]);

  return state;
}

function DrawerBody({ state, path }: { state: FilesState; path: string }) {
  if (state.status === "loading") {
    return <span className="meta">Loading diff…</span>;
  }

  if (state.status === "error") {
    return <span className="meta">Could not load diff: {state.message}</span>;
  }

  return (
    <DiffView model={diffViewModel(matchChangedFile(state.files, path))} />
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        // The button sits in a <summary>; without this the click would also fold the card.
        event.preventDefault();
        onClose();
      }}
    >
      Close
    </button>
  );
}

function DrawerContent({ state, path, prNumber }: DrawerContentProps) {
  if (prNumber === null) {
    return (
      <span className="meta">
        No pull request for this run — diffs unavailable.
      </span>
    );
  }

  return <DrawerBody state={state} path={path} />;
}

interface DrawerContentProps {
  state: FilesState;
  path: string;
  prNumber: number | null;
}

export default function FileDiffDrawer(props: FileDiffDrawerProps) {
  const { runId, path, prNumber, onClose } = props;
  const state = usePullFiles({
    runId,
    enabled: path !== null && prNumber !== null,
  });

  if (path === null) {
    return null;
  }

  return (
    <CollapsibleCard
      title={`Diff · ${path}`}
      defaultOpen
      actions={<CloseButton onClose={onClose} />}
    >
      <DrawerContent state={state} path={path} prNumber={prNumber} />
    </CollapsibleCard>
  );
}
