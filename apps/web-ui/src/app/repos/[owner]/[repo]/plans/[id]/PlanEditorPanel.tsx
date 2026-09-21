"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanMeta } from "@re-cinq/planning-document";
import { PlanEditor, type ProviderTransport } from "@re-cinq/planning-editor";
import { createHocuspocusTransport } from "@re-cinq/planning-editor/transports/hocuspocus";
import { FormError } from "@/components/FormError";
import type { PlanUser } from "@/lib/plan-user";
import type { PlanActions } from "./plan-actions";
import styles from "./PlanEditorPanel.module.scss";

interface PlanEditorPanelProps extends PlanActions {
  meta: PlanMeta;
  user: PlanUser;
}

type Connection = { transport: ProviderTransport } | { error: string };

export default function PlanEditorPanel({ meta, user, openSocket, approve }: PlanEditorPanelProps) {
  const connection = usePlanConnection(meta, openSocket);
  const [canApprove, setCanApprove] = useState(false);

  if (!connection) {
    return <p className="meta">Connecting…</p>;
  }

  return "error" in connection ? (
    <FormError message={connection.error} />
  ) : (
    <div className={styles.panel}>
      <ApproveBar status={meta.status} canApprove={canApprove} approve={approve} />
      <PlanEditor
        transport={connection.transport}
        user={user}
        validationPhase="approval"
        onValidation={(report) => setCanApprove(report.passed)}
      />
    </div>
  );
}

// One socket per mounted page, closed on unmount.
function usePlanConnection(meta: PlanMeta, openSocket: PlanActions["openSocket"]): Connection | null {
  const [connection, setConnection] = useState<Connection | null>(null);

  useEffect(() => {
    let closed = false;
    const opening = connectPlan(meta, openSocket);

    void opening.then((opened) => !closed && setConnection(opened));

    return () => {
      closed = true;
      void opening.then((opened) => "transport" in opened && opened.transport.destroy());
    };
  }, [meta, openSocket]);

  return connection;
}

// Every (re)connect asks the server for a fresh token, so a socket outlives its ten-minute token.
async function connectPlan(meta: PlanMeta, openSocket: PlanActions["openSocket"]): Promise<Connection> {
  const socket = await openSocket();
  const freshToken = async () => {
    const again = await openSocket();

    return "token" in again ? again.token : "";
  };

  return "error" in socket
    ? socket
    : { transport: createHocuspocusTransport({ url: socket.wsUrl, name: socket.documentName, meta, token: freshToken }) };
}

/** Approval ends the plan; lore-api validates it again, so the button is only a courtesy. */
function ApproveBar({ status, canApprove, approve }: { status: string; canApprove: boolean; approve: PlanActions["approve"] }) {
  const { error, run } = useApprove(approve);

  return status === "approved" ? null : (
    <div className={styles.approve}>
      <FormError message={error} />
      <button
        type="button"
        className="button"
        disabled={!canApprove}
        title={canApprove ? undefined : "The outline lists what the plan still needs"}
        onClick={run}
      >
        Approve plan
      </button>
    </div>
  );
}

function useApprove(approve: PlanActions["approve"]) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const run = () =>
    void approve().then((result) => (result.error ? setError(result.error) : router.refresh()));

  return { error, run };
}
