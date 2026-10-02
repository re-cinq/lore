"use server";

// What the live run list asks of the server: the token its channel opens with, and a fresh page to settle on after a gap.
import {
  getFloorRuns,
  mintRunsStreamToken,
  type FloorRunsPage,
} from "@/lib/api/floor-runs";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";

export type RunsChannelGrant = { token: string } | { error: string };

export async function openRunsChannelAction(): Promise<RunsChannelGrant> {
  const user = planUserOf((await getSession()) as PlanSession | null);

  if (!user) {
    return { error: "Sign in to follow the runs." };
  }
  const minted = await mintRunsStreamToken({ id: user.id, name: user.name });

  return minted.status === "ok"
    ? { token: minted.data.token }
    : { error: "Could not open the run list." };
}

export async function loadRunsPageAction(query: {
  status?: string;
  cursor?: string;
}): Promise<FloorRunsPage> {
  return getFloorRuns(query);
}
