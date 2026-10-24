import type { ImplementationLoop } from "@/lib/api/backlog";
import type { RepoLoop } from "@/lib/api/loops";
import OnboardingBanner from "../implementation/OnboardingBanner";
import LoopRunsFollower from "../LoopRunsFollower";
import { retryOnboardingAction } from "../actions";
import { boardSubject, loopBoard } from "./board";
import BoardView from "./BoardView";
import { readLoop } from "./read-loop";
import type { Paging } from "./section-limits";

interface LoopBoardProps {
  loops: readonly RepoLoop[];
  fullName: string;
  /** How many rows each section but Current shows, and how to load more. */
  paging: Paging;
}

/** Reads the shown loops at once and draws them as one board; a loop that cannot be read is named, and the others still show. */
export default async function LoopBoard({
  loops,
  fullName,
  paging,
}: LoopBoardProps) {
  const reads = await readLoops(loops, fullName, paging);
  const board = loopBoard(reads, paging.limits);

  return (
    <>
      <LoopRunsFollower runIds={board.runIds} />
      <ImplementationBanner reads={reads} fullName={fullName} />
      <BoardView
        board={board}
        subject={boardSubject(loops)}
        showLoop={loops.length > 1}
        loadMore={paging.loadMore}
      />
    </>
  );
}

function readLoops(
  loops: readonly RepoLoop[],
  fullName: string,
  { limits }: Paging,
) {
  return Promise.all(loops.map((loop) => readLoop(loop, fullName, limits)));
}

/** Why an enabled implementation loop picks nothing, when it is shown and its onboarding has not merged. */
function ImplementationBanner({
  reads,
  fullName,
}: {
  reads: readonly { implementation?: ImplementationLoop }[];
  fullName: string;
}) {
  const implementation = reads.find(
    (read) => read.implementation,
  )?.implementation;

  return implementation ? (
    <OnboardingBanner
      loop={implementation}
      retry={retryOnboardingAction.bind(null, fullName)}
    />
  ) : null;
}
