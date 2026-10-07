"use client";

import { useEffect, useState } from "react";
import type { PlanMeta } from "@re-cinq/planning-document";
import { transportFor, type ProviderTransport } from "@re-cinq/planning-editor";
import type { LiveSocketClient } from "@/lib/live-socket/client";
import { useLiveSocket } from "@/lib/live-socket/LiveSocketProvider";
import { planProvider } from "@/lib/live-socket/plan-provider";
import type { PlanSocket } from "./plan-actions";

export type Connection = { transport: ProviderTransport } | { error: string };

const NO_SOCKET = "The live socket is not configured (LORE_WS_URL).";
const UNREACHABLE = "Could not open the plan.";
const SOCKET_TIMEOUT_MS = 15_000;

/** One plan channel per mounted page on the tab's shared socket (ADR-048), closed on unmount; the socket itself outlives the page. Every `router.refresh()` hands the page a new meta, and a save moves its version: reconnecting on those tore the editor down under someone typing, so only what the editor shows of the plan reconnects it. */
export function usePlanConnection(meta: PlanMeta): Connection | null {
  const client = useLiveSocket();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [held, setHeld] = useState(meta);

  if (shownKey(held) !== shownKey(meta)) {
    setHeld(meta);
  }

  useEffect(() => {
    let closed = false;
    const opening = connectPlan(held, client);

    void opening.then((opened) => !closed && setConnection(opened));

    return () => {
      closed = true;
      void opening.then(
        (opened) => "transport" in opened && opened.transport.destroy(),
      );
    };
  }, [held, client]);

  return connection;
}

// The meta the editor is handed, without the version and time every save moves.
function shownKey(meta: PlanMeta): string {
  const { version: _version, updatedAt: _updatedAt, ...shown } = meta;

  return JSON.stringify(shown);
}

// Every (re)connect asks the socket route for a fresh token, so a channel outlives its ten-minute token, and outlives a deployment too.
async function connectPlan(
  meta: PlanMeta,
  client: LiveSocketClient | null,
): Promise<Connection> {
  if (client === null) {
    return { error: NO_SOCKET };
  }
  const socket = await fetchPlanSocket(meta);

  if ("error" in socket) {
    return socket;
  }
  const token = async () => {
    const again = await fetchPlanSocket(meta);

    return "token" in again ? again.token : "";
  };

  return { transport: planTransport(client, socket.documentName, meta, token) };
}

async function fetchPlanSocket(
  meta: PlanMeta,
): Promise<PlanSocket | { error: string }> {
  try {
    const res = await fetch(`/api/repos/${meta.repo}/plans/${meta.id}/socket`, {
      cache: "no-store",
      signal: AbortSignal.timeout(SOCKET_TIMEOUT_MS),
    });

    return (await res.json()) as PlanSocket | { error: string };
  } catch {
    return { error: UNREACHABLE };
  }
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
