"use client";

import { useState } from "react";
import type { PlanMeta } from "@re-cinq/planning-document";
import { PlanEditor, type ProviderTransport } from "@re-cinq/planning-editor";
import { FormError } from "@/components/FormError";
import type { PlanPageState } from "@/lib/plan-page-state";
import type { PlanUser } from "@/lib/plan-user";
import type { PlanActions } from "./plan-actions";
import PlanBlockAnchor from "./PlanBlockAnchor";
import PlanOutlineActions from "./PlanOutlineActions";
import { usePlanConnection } from "./usePlanConnection";
import { useRefineAsk } from "./useRefineAsk";

interface PlanEditorPanelProps extends PlanActions {
  meta: PlanMeta;
  user: PlanUser;
  state: PlanPageState;
  prUrl: string | null;
  prNumber: number | null;
  prTitle: string | null;
  prUnresolvedThreads: number | null;
}

interface ConnectedPlanProps extends PlanEditorPanelProps {
  transport: ProviderTransport;
}

export default function PlanEditorPanel(props: PlanEditorPanelProps) {
  const connection = usePlanConnection(props.meta);

  if (!connection) {
    return <p className="meta">Connecting…</p>;
  }

  return "error" in connection ? (
    <FormError message={connection.error} />
  ) : (
    <ConnectedPlan {...props} transport={connection.transport} />
  );
}

// An approved plan is read-only: lore-api's socket refuses writes to it already, and the editor says so instead of swallowing them.
function ConnectedPlan(props: ConnectedPlanProps) {
  const [canApprove, setCanApprove] = useState(false);
  const { meta, user, transport, refine, ...actions } = props;
  const { refusal, ask } = useRefineAsk(refine, props.state);
  const outlineActions = { ...actions, canApprove, refusal };

  return (
    <>
      <PlanBlockAnchor />
      <PlanEditor
        transport={transport}
        user={user}
        readOnly={meta.status === "approved"}
        validationPhase="approval"
        onValidation={(report) => setCanApprove(report.passed)}
        onRefine={ask}
        outlineFooter={<PlanOutlineActions {...outlineActions} />}
      />
    </>
  );
}
