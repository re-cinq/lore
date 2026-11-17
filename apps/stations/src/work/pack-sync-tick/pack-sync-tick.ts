// The catch-up for a webhook that never arrived (specs/client-packs FR-003): lore-api applies the pack's head under its lease, and an unchanged head changes nothing.
import type { RepoAnswer } from "../lib/repo-sweep.js";
import { packSyncAnswerLine } from "./pack-sync-answer.js";

export async function packSyncTick(
  sync: () => Promise<RepoAnswer>,
): Promise<string> {
  return packSyncAnswerLine(
    await sync().catch((err: unknown) => ({
      status: 0,
      body: (err as Error).message,
    })),
  );
}
