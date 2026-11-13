import { notFound } from "next/navigation";
import { planMetaSchema, type PlanMeta } from "@re-cinq/planning-document";
import { readPlan, readPlanStory, type PlanStory } from "@/lib/api/plans";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";
import PlanDetailLive from "./PlanDetailLive";
import { planPageTokens } from "./plan-page-tokens";
import {
  approvePlanAction,
  deletePlanAction,
  draftAgainAction,
  generatePrototypeAction,
  mintPlanRunTokenAction,
  openPlanSocketAction,
  refinePlanAction,
  removePlanStoryAction,
  reopenPlanAction,
  retrySpecWorkAction,
  reworkSpecsAction,
  savePlanStoryAction,
  validatePlanAction,
} from "./actions";

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; id: string }>;
}) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;
  const { meta, user, story, tokens } = await planPage(fullName, id);

  return (
    <PlanDetailLive
      meta={meta}
      user={user}
      story={story}
      collabSocket={tokens?.collab ?? null}
      planRunToken={tokens?.planRun ?? null}
      {...boundActions(fullName, id)}
    />
  );
}

// Every action bound to this plan of this repo on the server, so the client never names either.
function boundActions(fullName: string, id: string) {
  return {
    openSocket: openPlanSocketAction.bind(null, fullName, id),
    mintPlanRunToken: mintPlanRunTokenAction.bind(null, fullName, id),
    approve: approvePlanAction.bind(null, fullName, id),
    refine: refinePlanAction.bind(null, fullName, id),
    draftAgain: draftAgainAction.bind(null, fullName, id),
    reopen: reopenPlanAction.bind(null, fullName, id),
    retrySpecWork: retrySpecWorkAction.bind(null, fullName, id),
    reworkSpecs: reworkSpecsAction.bind(null, fullName, id),
    validate: validatePlanAction.bind(null, fullName, id),
    generatePrototype: generatePrototypeAction.bind(null, fullName, id),
    deletePlan: deletePlanAction.bind(null, fullName, id),
    saveStory: savePlanStoryAction.bind(null, fullName, id),
    removeStory: removePlanStoryAction.bind(null, fullName, id),
  };
}

// The plan, its story, who is looking, and the tokens their channels open with. The plan comes first, so a plan under another repo is not found before a token is minted; no run, visit or PR is read here (specs/plan-detail-fast-open FR3).
async function planPage(fullName: string, planId: string) {
  const [meta, story, session] = await Promise.all([
    repoPlanMeta(fullName, planId),
    storyOf(planId),
    getSession(),
  ]);
  const user = planUserOf(session as PlanSession | null);

  return {
    meta,
    story,
    user,
    tokens: await planPageTokens(fullName, planId, user),
  };
}

// A story that cannot be read is shown as none linked rather than failing the plan page.
async function storyOf(planId: string): Promise<PlanStory | null> {
  const read = await readPlanStory(planId);

  return read.status === "ok" ? read.data : null;
}

// A plan is only shown under the repo it belongs to.
async function repoPlanMeta(
  fullName: string,
  planId: string,
): Promise<PlanMeta> {
  const stored = await readPlan(planId);
  const plan = stored.status === "ok" ? stored.data.json : undefined;

  if (plan?.repo !== fullName) {
    notFound();
  }

  return planMetaSchema.parse(plan);
}
