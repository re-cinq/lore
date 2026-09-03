"use server";

import { revalidatePath } from "next/cache";
import {
  setClusterAgentPaused,
  restartClusterAgent,
} from "@/lib/api/cluster-agents";
import { enforceOk } from "@/lib/api/result";

/** Cluster in/out of rotation; identity bound server-side (browser never chooses). */
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
