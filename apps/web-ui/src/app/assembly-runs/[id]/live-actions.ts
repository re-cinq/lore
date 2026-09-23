"use server";

// The token a browser opens a run's channel with (ADR-048): minted by lore-api only after this tier has checked the person's session and their access to the run's repo — the same ladder every run proxy climbs.
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { mintRunStreamToken } from "@/lib/api/assembly-run-stream";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";

export type RunChannelGrant = { token: string } | { error: string };

const REFUSALS: Record<number, string> = {
  401: "Sign in to follow this run.",
  403: "You do not have access to this run's repo.",
  404: "This run was not found.",
};

export async function openRunChannelAction(
  runId: string,
): Promise<RunChannelGrant> {
  const auth = await authorizeAssemblyRunAccess(runId, "lore-api");

  if (isAssemblyRunAuthError(auth)) {
    return { error: REFUSALS[auth.status] ?? "Could not open the run." };
  }
  const user = planUserOf((await getSession()) as PlanSession | null);

  if (!user) {
    return { error: REFUSALS[401] };
  }
  const minted = await mintRunStreamToken(runId, {
    id: user.id,
    name: user.name,
  });

  return minted.status === "ok"
    ? { token: minted.data.token }
    : { error: "Could not open the run." };
}
