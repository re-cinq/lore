"use client";

// The run list's container: owns the live channel and the page's reducer, and hands the pure view its runs. A gap in the channel is closed by reloading the page the person is on.
import { useReducer, useRef, type Dispatch } from "react";
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
}

export default function AssemblyRunsLive({
  activeStatus,
  cursor,
  initial,
}: AssemblyRunsLiveProps) {
  const [state, dispatch] = useReducer(reduceRunList, initial, initialRunList);
  const reload = usePageReload({ activeStatus, cursor }, dispatch);

  useRunsChannel({
    runIds: state.runs.map((run) => run.id),
    onFrame: frameHandler({ dispatch, reload, onFirstPage: !cursor }),
    onConnectionChange: connectionChangeHandler(dispatch, reload),
  });

  return (
    <AssemblyRunListView
      activeStatus={activeStatus}
      cursor={cursor}
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

/** Reloads the current page; of overlapping reloads only the latest result lands. */
function usePageReload(
  query: { activeStatus?: string; cursor?: string },
  dispatch: Dispatch<RunListAction>,
): () => void {
  const latestReload = useRef(0);

  return () => {
    const ticket = ++latestReload.current;

    void loadRunsPageAction({
      status: query.activeStatus,
      cursor: query.cursor,
    }).then((page) => {
      if (ticket === latestReload.current) {
        dispatch({ type: "page_loaded", ...page });
      }
    });
  };
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
