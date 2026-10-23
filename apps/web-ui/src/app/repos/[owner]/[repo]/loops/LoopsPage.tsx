import { notFound } from "next/navigation";
import { Alert } from "@/components/Alert";
import {
  getRepoLoops,
  type LoopKey,
  type RepoLoop,
  type RepoLoops,
} from "@/lib/api/loops";
import type { ApiResult } from "@/lib/api/result";
import ImplementationLoopBody from "./implementation/ImplementationLoopBody";
import TriageBody from "./triage/TriageBody";
import LoopPicker from "./LoopPicker";
import LoopSwitch from "./LoopSwitch";
import { switchLoopAction } from "./actions";

interface LoopsPageProps {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ loop?: string }>;
}

const DEFAULT_LOOP: LoopKey = "implementation";

/** The Loops tab: every loop of the repository as a pill with its state, the chosen one's switch, then that loop's own page (specs/implementation-loop FR9, specs/issue-triage FR27). */
export default async function LoopsPage(props: LoopsPageProps) {
  const [{ owner, repo }, { loop }] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const fullName = `${owner}/${repo}`;
  const result = await getRepoLoops(fullName);

  if (result.status !== "ok") {
    return <LoadFailure result={result} />;
  }

  return (
    <LoopsView
      loops={result.data.loops}
      selected={selectedLoop(result.data.loops, loop)}
      fullName={fullName}
    />
  );
}

interface LoopsViewProps {
  loops: readonly RepoLoop[];
  selected: RepoLoop;
  fullName: string;
}

function LoopsView({ loops, selected, fullName }: LoopsViewProps) {
  return (
    <div>
      <LoopPicker
        loops={loops}
        selected={selected.key}
        base={`/repos/${fullName}/loops`}
      />
      <LoopSwitch
        label={selected.label}
        description={selected.description}
        enabled={selected.enabled}
        toggle={switchLoopAction.bind(null, fullName, selected.key)}
      />
      <LoopBody loopKey={selected.key} fullName={fullName} />
    </div>
  );
}

/** Names the connection rather than the symptom: an unreachable API and a repository with no loops would otherwise look the same. */
function LoadFailure({
  result,
}: {
  result: Exclude<ApiResult<RepoLoops>, { status: "ok" }>;
}) {
  const reason =
    result.status === "error" ? result.message : "Lore API unconfigured";

  return (
    <Alert variant="secondary">
      Could not load the repository&apos;s loops ({reason}) — check the Lore API
      connection and reload.
    </Alert>
  );
}

/** The loop the query names, the first loop when it names none, and a 404 when it names one the repository does not have. */
function selectedLoop(
  loops: readonly RepoLoop[],
  requested: string | undefined,
): RepoLoop {
  const found = loops.find((l) => l.key === (requested ?? DEFAULT_LOOP));

  if (!found) {
    notFound();
  }

  return found;
}

function LoopBody({
  loopKey,
  fullName,
}: {
  loopKey: LoopKey;
  fullName: string;
}) {
  if (loopKey === "triage") {
    return <TriageBody fullName={fullName} />;
  }

  return <ImplementationLoopBody fullName={fullName} />;
}
