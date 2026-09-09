import type { AgentRunTurnsRepository } from "@re-cinq/lore-shared";

// Flattens `pipeline.agent_run_turns` rows into a UTF-16 offset-addressable log slice, resumable via cursor (#1307).

const LOG_SLICE_MAX = 256 * 1024;

const TURNS_PAGE_SIZE = 1000;

export interface TurnSlice {
  slice: string;
  hasMore: boolean;
  sawTurns: boolean;
  cursor: string;
}

interface TurnResume {
  afterId: string;
  consumed: number;
}

const PG_BIGINT_MAX = 9223372036854775807n;

// Parses `<taskId>:<rowId>:<chars>`; trusted only for this task with chars<=offset (offset 0 always ignores it), and an id past PG bigint range is rejected to avoid a 500 in `id > $2::bigint`.
export function parseTurnCursor(
  raw: string | undefined,
  taskId: string,
  offset: number,
): TurnResume | null {
  if (!raw || offset === 0) {
    return null;
  }
  const match = /^(.+):(\d{1,19}):(\d{1,19})$/.exec(raw);

  if (!match) {
    return null;
  }
  const [, cursorTask, afterId, chars] = match;
  const consumed = Number(chars);

  if (cursorMismatches({ cursorTask, taskId, consumed, offset, afterId })) {
    return null;
  }

  return { afterId, consumed };
}

interface CursorMatch {
  cursorTask: string;
  taskId: string;
  consumed: number;
  offset: number;
  afterId: string;
}

function cursorMismatches(match: CursorMatch): boolean {
  if (match.cursorTask !== match.taskId || match.consumed > match.offset) {
    return true;
  }

  return BigInt(match.afterId) > PG_BIGINT_MAX;
}

interface TurnScanState {
  consumed: number;
  boundaryId: string;
  boundaryChars: number;
  slice: string;
  mustValidateResume: boolean;
}

type TurnRow = Awaited<
  ReturnType<AgentRunTurnsRepository["listByTask"]>
>[number];

interface TurnScanStart {
  state: TurnScanState;
  afterId: string;
  sawTurns: boolean;
}

// Flattens turns to the UTF-16 slice [offset, offset+LOG_SLICE_MAX); `resume` seeks straight to the previous cursor's row boundary instead of re-paging the whole prefix (#1307) — a stale/forged offset past the boundary falls back to a full rescan from row id 0, while an at-boundary cursor is trusted as-is (bearer-scoped, so a forged skip only affects the forger's own read); a rewind below the boundary self-heals the same way.
export async function readTurnSlice(
  turns: AgentRunTurnsRepository,
  taskId: string,
  offset: number,
  resume: TurnResume | null,
): Promise<TurnSlice> {
  const scan = initTurnScanState(resume, offset);
  const walked = await walkTurnPages(turns, { taskId, offset }, scan);

  return walked ?? readTurnSlice(turns, taskId, offset, null);
}

// Seeds the scan state from a validated resume cursor, or from scratch.
function initTurnScanState(
  resume: TurnResume | null,
  offset: number,
): TurnScanStart {
  const consumed = resume?.consumed ?? 0;
  const afterId = resume?.afterId ?? "0";

  return {
    state: {
      consumed,
      boundaryId: afterId,
      boundaryChars: consumed,
      slice: "",
      mustValidateResume: resume !== null && offset > consumed,
    },
    afterId,
    sawTurns: resume !== null,
  };
}

// Pages forward until the scan finishes; `null` means the resume cursor proved stale and the whole walk has to start over from row id 0.
async function walkTurnPages(
  turns: AgentRunTurnsRepository,
  { taskId, offset }: { taskId: string; offset: number },
  scan: { state: TurnScanState; afterId: string; sawTurns: boolean },
): Promise<TurnSlice | null> {
  const { state } = scan;
  let afterId = scan.afterId;
  let sawTurns = scan.sawTurns;

  for (;;) {
    const page = await turns.listByTask(taskId, afterId, TURNS_PAGE_SIZE);

    sawTurns = sawTurns || page.length > 0;
    const step = stepTurnScan(state, page, { taskId, offset, sawTurns });

    if (step.kind !== "continue") {
      return step.kind === "done" ? step.result : null;
    }
    afterId = step.afterId;
  }
}

type TurnScanStep =
  | { kind: "restart" }
  | { kind: "done"; result: TurnSlice }
  | { kind: "continue"; afterId: string };

interface TurnScanPageContext {
  taskId: string;
  offset: number;
  sawTurns: boolean;
}

// Folds one fetched page into the scan, deciding whether the walk restarts, finishes, or continues.
function stepTurnScan(
  state: TurnScanState,
  page: Awaited<ReturnType<AgentRunTurnsRepository["listByTask"]>>,
  context: TurnScanPageContext,
): TurnScanStep {
  if (state.mustValidateResume && page.length === 0) {
    return { kind: "restart" };
  }
  const outcome = consumeTurnPage(state, page, context.offset);

  if (outcome === "restart") {
    return { kind: "restart" };
  }

  if (outcome === "sliced" || page.length < TURNS_PAGE_SIZE) {
    return scanDone(state, context, { sliced: outcome === "sliced" });
  }

  return { kind: "continue", afterId: nextPageAfterId(page, state) };
}

// Folds one page into the scan state: "restart" when the resume cursor proves stale, "sliced" when the slice budget is exhausted mid-page, else null.
function consumeTurnPage(
  state: TurnScanState,
  page: Awaited<ReturnType<AgentRunTurnsRepository["listByTask"]>>,
  offset: number,
): "restart" | "sliced" | null {
  for (const row of page) {
    const outcome = consumeTurnRow(state, row, offset);

    if (outcome) {
      return outcome;
    }
  }

  return null;
}

// Folds one row into the scan state: "restart" when the resume cursor proves stale, "sliced" when the slice budget is exhausted mid-row, else null.
function consumeTurnRow(
  state: TurnScanState,
  row: TurnRow,
  offset: number,
): "restart" | "sliced" | null {
  if (state.slice.length >= LOG_SLICE_MAX) {
    return "sliced";
  }
  const line = `${JSON.stringify(row.envelope)}\n`;
  const lineEndsBeforeOffset = state.consumed + line.length <= offset;

  if (state.mustValidateResume && lineEndsBeforeOffset) {
    return "restart";
  }
  state.mustValidateResume = false;

  if (lineEndsBeforeOffset) {
    skipRowBeforeOffset(state, row, line);

    return null;
  }

  return appendRowToSlice(state, row, line, offset);
}

// Consumes one row already known to end at or before the offset — advances past it without adding to the slice.
function skipRowBeforeOffset(
  state: TurnScanState,
  row: TurnRow,
  line: string,
): void {
  state.consumed += line.length;
  advanceBoundary(state, row);
}

// Appends the offset-relative piece of one row to the slice; "sliced" when the row didn't fit whole.
function appendRowToSlice(
  state: TurnScanState,
  row: TurnRow,
  line: string,
  offset: number,
): "sliced" | null {
  const start = Math.max(0, offset - state.consumed);
  const piece = line.substring(
    start,
    start + (LOG_SLICE_MAX - state.slice.length),
  );

  state.slice += piece;

  if (start + piece.length < line.length) {
    return "sliced";
  }
  state.consumed += line.length;
  advanceBoundary(state, row);

  return null;
}

function advanceBoundary(state: TurnScanState, row: TurnRow): void {
  state.boundaryId = row.id;
  state.boundaryChars = state.consumed;
}

// The terminal step, carrying the slice the scan accumulated; `sliced` says the budget ran out mid-row, which is what "there is more" means here.
function scanDone(
  state: TurnScanState,
  context: TurnScanPageContext,
  { sliced }: { sliced: boolean },
): TurnScanStep {
  return {
    kind: "done",
    result: turnSliceResult(context.taskId, state, {
      hasMore: sliced,
      sawTurns: context.sawTurns,
    }),
  };
}

function turnSliceResult(
  taskId: string,
  state: TurnScanState,
  { hasMore, sawTurns }: { hasMore: boolean; sawTurns: boolean },
): TurnSlice {
  return {
    slice: state.slice,
    hasMore,
    sawTurns,
    cursor: `${taskId}:${state.boundaryId}:${state.boundaryChars}`,
  };
}

function nextPageAfterId(
  page: Awaited<ReturnType<AgentRunTurnsRepository["listByTask"]>>,
  state: TurnScanState,
): string {
  const last = page.at(-1);

  return last ? last.id : state.boundaryId;
}
