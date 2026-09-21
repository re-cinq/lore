import type { PlanMeta } from "@re-cinq/planning-document";
import { Alert } from "@/components/Alert";
import { isDraftingPlan } from "@/lib/plan-run-phase";
import type { PlanUser } from "@/lib/plan-user";
import DraftingPlan from "./DraftingPlan";
import PlanStatusBadge from "../PlanStatusBadge";
import PlanRunCard, { type PlanRun } from "./PlanRunCard";
import PlanWorkspace from "./PlanWorkspace";
import type { PlanActions } from "./plan-actions";
import styles from "./PlanDetailView.module.scss";

interface PlanDetailViewProps extends PlanActions {
  meta: PlanMeta;
  run: PlanRun | null;
  user: PlanUser | null;
  draftAgain: () => Promise<{ error?: string }>;
}

export default function PlanDetailView({
  meta,
  run,
  user,
  draftAgain,
  ...actions
}: PlanDetailViewProps) {
  return (
    <div>
      <PlanHeader meta={meta} />
      <PlanRunCard run={run} draftAgain={draftAgain} />
      <PlanBody meta={meta} run={run} user={user} {...actions} />
    </div>
  );
}

type PlanBodyProps = Omit<PlanDetailViewProps, "draftAgain">;

// The draft being written would replace anything typed into it, so the editor waits for it.
function PlanBody({ meta, run, user, ...actions }: PlanBodyProps) {
  if (run && isDraftingPlan(run, run.nodes)) {
    return <DraftingPlan />;
  }

  return user ? (
    <PlanWorkspace meta={meta} user={user} {...actions} />
  ) : (
    <Alert variant="secondary">Sign in to open this plan.</Alert>
  );
}

function PlanHeader({ meta }: { meta: PlanMeta }) {
  return (
    <div className={styles.header}>
      <p className="meta">
        {meta.type} plan · version {meta.version} · by {meta.createdBy}
      </p>
      <PlanStatusBadge status={meta.status} />
    </div>
  );
}
