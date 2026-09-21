"use client";

import { useEffect, useState } from "react";
import type { PlanMeta } from "@re-cinq/planning-document";
import { PlanEditor, type ProviderTransport } from "@re-cinq/planning-editor";
import { createHocuspocusTransport } from "@re-cinq/planning-editor/transports/hocuspocus";
import { FormError } from "@/components/FormError";
import type { PlanUser } from "@/lib/plan-user";
import type { PlanActions } from "./plan-actions";
import ApprovePlanButton from "./ApprovePlanButton";

interface PlanEditorPanelProps extends PlanActions {
  meta: PlanMeta;
  user: PlanUser;
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

function ConnectedPlan(props: ConnectedPlanProps) {
  const [canApprove, setCanApprove] = useState(false);
  const { meta, user, transport, approve, refine } = props;

  return (
    <PlanEditor
      transport={transport}
      user={user}
      validationPhase="approval"
      onValidation={(report) => setCanApprove(report.passed)}
      onRefine={(request) => askOrWithdraw(refine, request)}
      outlineFooter={
        meta.status !== "approved" && (
          <ApprovePlanButton canApprove={canApprove} approve={approve} />
        )
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
