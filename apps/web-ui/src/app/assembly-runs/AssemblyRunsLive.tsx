"use client";

// The run list's container: owns the live channel and the page's reducer, and hands the pure view its runs. A gap in the channel is closed by reloading the page the person is on.
import { useReducer, useRef, type Dispatch, type ReactNode } from "react";
import type { FloorRunsPage } from "@/lib/api/floor-runs";
import { floorRunOf } from "@/lib/assembly-run-rows";
import type { ChannelState } from "@/lib/live-socket/connection-machine";
import type { RunListFrame } from "@/lib/live-socket/protocol";
import AssemblyRunListView from "./AssemblyRunListView";
import {
  initialRunList,
  reduceRunList,
  type RunListAction,
} from "./run-list-reducer";
import { loadRunsPageAction } from "./runs-live-actions";
import { useRunsChannel } from "./useRunsChannel";

interface AssemblyRunsLiveProps {
  activeStatus?: string;
  cursor?: string;
  initial: FloorRunsPage;
  /** `owner/name` of the one repository the list is scoped to. */
  repo?: string;
  basePath?: string;
  heading?: ReactNode;
}

export default function AssemblyRunsLive(props: AssemblyRunsLiveProps) {
  const { activeStatus, cursor, initial, repo } = props;
  const [state, dispatch] = useReducer(reduceRunList, initial, initialRunList);
  const reload = usePageReload({ repo, activeStatus, cursor }, dispatch);

  useRunsChannel({
    runIds: state.runs.map((run) => run.id),
    onFrame: frameHandler({ dispatch, reload, onFirstPage: !cursor }),
    onConnectionChange: connectionChangeHandler(dispatch, reload),
  });

  return (
    <AssemblyRunListView
      activeStatus={activeStatus}
      cursor={cursor}
      basePath={props.basePath}
      heading={props.heading}
      {...state}
    />
  );
}

interface FrameContext {
  dispatch: Dispatch<RunListAction>;
  reload: () => void;
  onFirstPage: boolean;
}

function frameHandler({ dispatch, reload, onFirstPage }: FrameContext) {
  const handlers: Record<RunListFrame["type"], (frame: RunListFrame) => void> =
    {
      run_row: (frame) => {
        if (frame.type === "run_row") {
          dispatch({ type: "run_row", run: floorRunOf(frame.run) });
        }
      },
      // A keyset page does not shift when something starts: only the first page has a new row to show.
      run_started: () => {
        if (onFirstPage) {
          reload();
        }
      },
      resync: reload,
    };

  return (frame: RunListFrame) => handlers[frame.type](frame);
}

type ReadState = "idle" | "reading" | "stale";

/** Reads the current page one read at a time: a request made during a read owes exactly one more read once it ends, however many came. */
function usePageReload(
  query: { repo?: string; activeStatus?: string; cursor?: string },
  dispatch: Dispatch<RunListAction>,
): () => void {
  const readState = useRef<ReadState>("idle");
  const readPage = async () => {
    const { repo, activeStatus: status, cursor } = query;
    const page = await loadRunsPageAction({ repo, status, cursor });

    dispatch({ type: "page_loaded", ...page });
  };

  return () => {
    if (readState.current !== "idle") {
      readState.current = "stale";

      return;
    }

    void readWhileAsked(readState, readPage);
  };
}

async function readWhileAsked(
  readState: { current: ReadState },
  read: () => Promise<void>,
): Promise<void> {
  readState.current = "reading";

  try {
    await read();
  } finally {
    if (settle(readState)) {
      void readWhileAsked(readState, read);
    }
  }
}

/** Back to idle, even when the read rejected; says whether another was asked for meanwhile. */
function settle(readState: { current: ReadState }): boolean {
  const isOwed = readState.current === "stale";

  readState.current = "idle";

  return isOwed;
}

/** Every `live` reloads the page: a run started before the socket first opened was never announced to this tab, and one started while it was away was missed. */
function connectionChangeHandler(
  dispatch: Dispatch<RunListAction>,
  reload: () => void,
): (state: ChannelState) => void {
  return (state) => {
    dispatch({ type: "connection", state });

    if (state === "live") {
      reload();
    }
  };
}
