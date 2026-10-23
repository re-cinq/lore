import type { ImplementationLoop } from "@/lib/api/backlog";
import type { RepoLoop } from "@/lib/api/loops";
import OnboardingBanner from "../implementation/OnboardingBanner";
import LoopRunsFollower from "../LoopRunsFollower";
import { retryOnboardingAction } from "../actions";
import { boardSubject, loopBoard } from "./board";
import BoardView from "./BoardView";
import { readLoop } from "./read-loop";

interface LoopBoardProps {
  loops: readonly RepoLoop[];
  fullName: string;
}

/** Reads the shown loops at once and draws them as one board; a loop that cannot be read is named, and the others still show. */
export default async function LoopBoard({ loops, fullName }: LoopBoardProps) {
  const reads = await Promise.all(
    loops.map((loop) => readLoop(loop, fullName)),
  );
  const board = loopBoard(reads);

  return (
    <>
      <LoopRunsFollower runIds={board.runIds} />
      <ImplementationBanner reads={reads} fullName={fullName} />
      <BoardView
        board={board}
        subject={boardSubject(loops)}
        showLoop={loops.length > 1}
      />
    </>
  );
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
