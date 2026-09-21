import type { PlanMeta } from "@re-cinq/planning-document";
import { Alert } from "@/components/Alert";
import type { PlanUser } from "@/lib/plan-user";
import PlanStatusBadge from "../PlanStatusBadge";
import PlanWorkspace from "./PlanWorkspace";
import type { PlanActions } from "./plan-actions";
import styles from "./PlanDetailView.module.scss";

interface PlanDetailViewProps extends PlanActions {
  meta: PlanMeta;
  user: PlanUser | null;
}

export default function PlanDetailView({ meta, user, ...actions }: PlanDetailViewProps) {
  return (
    <div>
      <div className={styles.header}>
        <p className="meta">
          {meta.type} plan · version {meta.version} · by {meta.createdBy}
        </p>
        <PlanStatusBadge status={meta.status} />
      </div>
      {user ? (
        <PlanWorkspace meta={meta} user={user} {...actions} />
      ) : (
        <Alert variant="secondary">Sign in to open this plan.</Alert>
      )}
    </div>
  );
}
