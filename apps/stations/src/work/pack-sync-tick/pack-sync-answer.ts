// What a push handler and the tick log of lore-api's answer to `POST /api/pack/sync`.
import { PackSyncResultSchema } from "@re-cinq/lore-shared/models/pack-sync-state.js";
import { packSyncResultLine } from "@re-cinq/lore-shared/pack-sync-result-line.js";
import type { RepoAnswer } from "../lib/repo-sweep.js";

export function packSyncAnswerLine(answer: RepoAnswer): string {
  if (answer.status !== 200) {
    return answer.status === 0
      ? answer.body
      : `HTTP ${answer.status} ${answer.body.slice(0, 300)}`;
  }
  const result = PackSyncResultSchema.safeParse(parsedJson(answer.body));

  return result.success
    ? packSyncResultLine(result.data)
    : `200 with an unreadable answer: ${answer.body.slice(0, 300)}`;
}

function parsedJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
