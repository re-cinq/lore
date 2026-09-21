import type { PlanMeta } from "@re-cinq/planning-document";
import { Alert } from "@/components/Alert";
import type { PlanUser } from "@/lib/plan-user";
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
      {user ? (
        <PlanWorkspace meta={meta} user={user} {...actions} />
      ) : (
        <Alert variant="secondary">Sign in to open this plan.</Alert>
      )}
    </div>
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
