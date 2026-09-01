"use server";

import { revalidatePath } from "next/cache";
import {
  setClusterAgentPaused,
  restartClusterAgent,
} from "@/lib/api/cluster-agents";
import { enforceOk } from "@/lib/api/result";

/** Take a cluster out of the rotation, or put it back. Identity is a LEADING
 *  BOUND PARAMETER — the page binds the agent id server-side, so the browser
 *  never chooses which cluster is paused. */
export async function toggleClusterPausedAction(
  id: string,
  paused: boolean,
): Promise<void> {
  enforceOk("pause cluster agent", await setClusterAgentPaused(id, paused));
  revalidatePath("/cluster-agents");
}

/** Bounces the central cluster-agent so it re-pulls `latest` on restart. */
export async function restartClusterAgentAction(id: string): Promise<void> {
  enforceOk("restart cluster agent", await restartClusterAgent(id));
  revalidatePath("/cluster-agents");
}
