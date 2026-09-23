import type { PlanMeta } from "@re-cinq/planning-document";
import { Alert } from "@/components/Alert";
import ConfirmedActionButton from "@/components/ConfirmedActionButton";
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
  deletePlan: () => Promise<{ error?: string }>;
}

export default function PlanDetailView({
  meta,
  run,
  user,
  draftAgain,
  deletePlan,
  ...actions
}: PlanDetailViewProps) {
  const state = planPageState(meta.status, run);
  const card = { run, state, draftAgain, reopen: actions.reopen };

  return (
    <div>
      <PlanHeader meta={meta} deletePlan={deletePlan} />
      <PlanRunCard {...card} />
      <PlanBody meta={meta} run={run} user={user} state={state} {...actions} />
    </div>
  );
}

type PlanBodyProps = Omit<PlanDetailViewProps, "draftAgain" | "deletePlan"> & {
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

type PlanHeaderProps = Pick<PlanDetailViewProps, "meta" | "deletePlan">;

function PlanHeader({ meta, deletePlan }: PlanHeaderProps) {
  return (
    <div className={styles.header}>
      <p className="meta">
        {meta.type} plan · version {meta.version} · by {meta.createdBy}
        {meta.approval &&
          ` · approved by ${meta.approval.approvedBy} on ${approvedOn(meta.approval.approvedAt)}`}
      </p>
      <div className={styles.headerActions}>
        <PlanStatusBadge status={meta.status} />
        <ConfirmedActionButton
          action={deletePlan}
          label="Delete plan"
          question={deleteQuestion(meta.title)}
        />
      </div>
    </div>
  );
}

function deleteQuestion(title: string) {
  return {
    title: "Delete the plan?",
    body: `${title} is removed for good, with every version of it. This cannot be undone.`,
    confirmLabel: "Delete",
    tone: "danger",
    typeToConfirm: title,
  } as const;
}

function approvedOn(iso: string): string {
  const when = new Date(iso);

  return Number.isNaN(when.getTime()) ? iso : when.toLocaleDateString();
}
