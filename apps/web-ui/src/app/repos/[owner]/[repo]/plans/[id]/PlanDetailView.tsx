import type { PlanMeta } from "@re-cinq/planning-document";
import { Alert } from "@/components/Alert";
import { planPageState, type PlanPageState } from "@/lib/plan-page-state";
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
  const state = planPageState(meta.status, run);

  return (
    <div>
      <PlanHeader meta={meta} />
      <PlanRunCard run={run} state={state} draftAgain={draftAgain} />
      <PlanBody meta={meta} run={run} user={user} state={state} {...actions} />
    </div>
  );
}

type PlanBodyProps = Omit<PlanDetailViewProps, "draftAgain"> & {
  state: PlanPageState;
};

// The draft being written would replace anything typed into it, so the editor waits for it.
function PlanBody({ meta, run, user, state, ...actions }: PlanBodyProps) {
  if (state === "drafting") {
    return <DraftingPlan />;
  }

  if (!user) {
    return <Alert variant="secondary">Sign in to open this plan.</Alert>;
  }

  return (
    <PlanWorkspace
      meta={meta}
      user={user}
      state={state}
      {...specPrOf(run)}
      {...actions}
    />
  );
}

function specPrOf(run: PlanRun | null): Pick<PlanRun, "prUrl" | "prNumber"> {
  return { prUrl: run?.prUrl ?? null, prNumber: run?.prNumber ?? null };
}

function PlanHeader({ meta }: { meta: PlanMeta }) {
  return (
    <div className={styles.header}>
      <p className="meta">
        {meta.type} plan · version {meta.version} · by {meta.createdBy}
        {meta.approval &&
          ` · approved by ${meta.approval.approvedBy} on ${approvedOn(meta.approval.approvedAt)}`}
      </p>
      <PlanStatusBadge status={meta.status} />
    </div>
  );
}

function approvedOn(iso: string): string {
  const when = new Date(iso);

  return Number.isNaN(when.getTime()) ? iso : when.toLocaleDateString();
}
