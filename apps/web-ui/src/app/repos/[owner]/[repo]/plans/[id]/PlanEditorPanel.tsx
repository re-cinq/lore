"use client";

import { useEffect, useState } from "react";
import type { PlanMeta } from "@re-cinq/planning-document";
import { PlanEditor, type ProviderTransport } from "@re-cinq/planning-editor";
import { createHocuspocusTransport } from "@re-cinq/planning-editor/transports/hocuspocus";
import { FormError } from "@/components/FormError";
import type { PlanPageState } from "@/lib/plan-page-state";
import type { PlanUser } from "@/lib/plan-user";
import type { PlanActions } from "./plan-actions";
import PlanOutlineActions from "./PlanOutlineActions";

interface PlanEditorPanelProps extends PlanActions {
  meta: PlanMeta;
  user: PlanUser;
  state: PlanPageState;
  prUrl: string | null;
  prNumber: number | null;
}

interface ConnectedPlanProps extends PlanEditorPanelProps {
  transport: ProviderTransport;
}

type Connection = { transport: ProviderTransport } | { error: string };

export default function PlanEditorPanel(props: PlanEditorPanelProps) {
  const connection = usePlanConnection(props.meta, props.openSocket);

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

  return (
    <PlanEditor
      transport={transport}
      user={user}
      readOnly={meta.status === "approved"}
      validationPhase="approval"
      onValidation={(report) => setCanApprove(report.passed)}
      onRefine={(request) => askOrWithdraw(refine, request)}
      outlineFooter={
        <PlanOutlineActions {...actions} canApprove={canApprove} />
      }
    />
  );
}

// One socket per mounted page, closed on unmount.
function usePlanConnection(
  meta: PlanMeta,
  openSocket: PlanActions["openSocket"],
): Connection | null {
  const [connection, setConnection] = useState<Connection | null>(null);

  useEffect(() => {
    let closed = false;
    const opening = connectPlan(meta, openSocket);

    void opening.then((opened) => !closed && setConnection(opened));

    return () => {
      closed = true;
      void opening.then(
        (opened) => "transport" in opened && opened.transport.destroy(),
      );
    };
  }, [meta, openSocket]);

  return connection;
}

// Every (re)connect asks the server for a fresh token, so a socket outlives its ten-minute token.
async function connectPlan(
  meta: PlanMeta,
  openSocket: PlanActions["openSocket"],
): Promise<Connection> {
  const socket = await openSocket();
  const token = async () => {
    const again = await openSocket();

    return "token" in again ? again.token : "";
  };

  return "error" in socket
    ? socket
    : {
        transport: createHocuspocusTransport({
          url: socket.wsUrl,
          name: socket.documentName,
          meta,
          token,
        }),
      };
}

// The editor withdraws a Refine whose promise rejects, so a refused ask must throw.
async function askOrWithdraw(
  refine: PlanActions["refine"],
  request: Parameters<PlanActions["refine"]>[0],
): Promise<void> {
  const asked = await refine(request);

  if (asked.error) {
    throw new Error(asked.error);
  }
}
