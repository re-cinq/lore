import type { ClosedWork } from "@re-cinq/lore-shared/changelog/changelog-week.js";
import { projectFor } from "./project-boot.js";

/** What merged and what closed in a repo since an instant, the two reads a week and a release are both made of. */
export async function closedWorkSince(
  repo: string,
  { from }: { from: string },
): Promise<ClosedWork> {
  const project = await projectFor(repo);
  const [merged, closed] = await Promise.all([
    project.pulls.listMergedSince(from),
    project.issues.list({ state: "closed", since: from }),
  ]);

  return { merged, closed };
}
