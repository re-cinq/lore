import Link from "next/link";
import { Alert } from "@/components/Alert";
import type { PlanSummary } from "@/lib/api/plans";
import PlanStatusBadge from "./PlanStatusBadge";
import styles from "./PlanListView.module.scss";

interface PlanListViewProps {
  base: string;
  plans: PlanSummary[];
}

export default function PlanListView({ base, plans }: PlanListViewProps) {
  return (
    <div>
      <div className={styles.header}>
        <p className={`meta ${styles.count}`}>
          {plans.length} plan{plans.length === 1 ? "" : "s"}
        </p>
        <Link href={`${base}/new`} className="button">
          + Plan
        </Link>
      </div>
      <PlanGrid base={base} plans={plans} />
    </div>
  );
}

/** The plans, or an invitation to write one, naming the control by its label. */
function PlanGrid({ base, plans }: PlanListViewProps) {
  if (plans.length === 0) {
    return (
      <div className="spec-card">
        <Alert variant="secondary">
          No plans yet. Click <strong>+ Plan</strong> to write one with the
          planning agent.
        </Alert>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {plans.map((plan) => (
        <PlanCard key={plan.id} base={base} plan={plan} />
      ))}
    </div>
  );
}

function PlanCard({ base, plan }: { base: string; plan: PlanSummary }) {
  return (
    <Link href={`${base}/${plan.id}`} className={`spec-card ${styles.card}`}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{plan.title}</h3>
        <PlanStatusBadge status={plan.status} />
      </div>
      <p className={`meta ${styles.detail}`}>
        {plan.type} plan · version {plan.version} · by {plan.createdBy}
      </p>
    </Link>
  );
}
