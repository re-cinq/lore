"use server";

import { moveMirror } from "@/lib/api/repos";
import {
  mirrorMoveOutcome,
  type MirrorMoveOutcome,
  type MirrorMoveRequest,
} from "./mirror-move-outcome";

/** Previews or does the mirror's move for the repository (specs/public-mirror) and answers the counts or the sentence the card shows; the settings page is not revalidated, since the move leaves the saved mirror's field as it was. */
export async function moveMirrorAction(
  repo: string,
  request: MirrorMoveRequest,
): Promise<MirrorMoveOutcome> {
  return mirrorMoveOutcome(await moveMirror(repo, request));
}
