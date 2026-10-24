import type { RepoLoop } from "@/lib/api/loops";
import { retryOnboardingAction } from "../actions";
import { boardSubject } from "./board";
import { readLoop } from "./read-loop";
import type { Paging } from "./section-limits";
import StreamingBoard from "./StreamingBoard";

interface LoopBoardProps {
  loops: readonly RepoLoop[];
  fullName: string;
  /** How many rows each section but Current shows, and where Load more links. */
  paging: Paging;
}

/** Starts every shown loop's read at once and hands the reads to the board unawaited, so each loop's rows draw as soon as they arrive instead of after the slowest; a loop that cannot be read is named, and the others still show. */
export default function LoopBoard({ loops, fullName, paging }: LoopBoardProps) {
  return (
    <StreamingBoard
      loops={loops}
      reads={loops.map((loop) => readLoop(loop, fullName, paging.limits))}
      paging={paging}
      subject={boardSubject(loops)}
      retry={retryOnboardingAction.bind(null, fullName)}
    />
  );
}
