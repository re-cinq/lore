"use client";

import { useEffect, useState } from "react";
import type { PlanMeta } from "@re-cinq/planning-document";
import {
  PlanEditor,
  transportFor,
  type ProviderTransport,
} from "@re-cinq/planning-editor";
import { FormError } from "@/components/FormError";
import type { LiveSocketClient } from "@/lib/live-socket/client";
import { useLiveSocket } from "@/lib/live-socket/LiveSocketProvider";
import { planProvider } from "@/lib/live-socket/plan-provider";
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
  prTitle: string | null;
  prUnresolvedThreads: number | null;
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

// One plan channel per mounted page on the tab's shared socket (ADR-048), closed on unmount; the socket itself outlives the page.
function usePlanConnection(
  meta: PlanMeta,
  openSocket: PlanActions["openSocket"],
): Connection | null {
  const client = useLiveSocket();
  const [connection, setConnection] = useState<Connection | null>(null);

  useEffect(() => {
    let closed = false;
    const opening = connectPlan(meta, openSocket, client);

    void opening.then((opened) => !closed && setConnection(opened));

    return () => {
      closed = true;
      void opening.then(
        (opened) => "transport" in opened && opened.transport.destroy(),
      );
    };
  }, [meta, openSocket, client]);

  return connection;
}

const NO_SOCKET = "The live socket is not configured (LORE_WS_URL).";

// Every (re)connect asks the server for a fresh token, so a channel outlives its ten-minute token.
async function connectPlan(
  meta: PlanMeta,
  openSocket: PlanActions["openSocket"],
  client: LiveSocketClient | null,
): Promise<Connection> {
  if (client === null) {
    return { error: NO_SOCKET };
  }
  const socket = await openSocket();

  if ("error" in socket) {
    return socket;
  }
  const token = async () => {
    const again = await openSocket();

    return "token" in again ? again.token : "";
  };

  return { transport: planTransport(client, socket.documentName, meta, token) };
}

/** The editor's transport on a plan channel of the shared socket; destroying it tears the provider and its channel down together. */
function planTransport(
  client: LiveSocketClient,
  documentName: string,
  meta: PlanMeta,
  token: () => Promise<string>,
): ProviderTransport {
  const plan = planProvider(client, documentName, token);
  const transport = transportFor(plan.provider, meta);

  // The editor's own teardown first (its subscriptions on the provider), then the provider and its channel; Hocuspocus's destroy tolerates the second call.
  return {
    ...transport,
    destroy: () => {
      transport.destroy();
      plan.destroy();
    },
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
