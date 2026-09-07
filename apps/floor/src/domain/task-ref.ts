/** Render the Lore-Task trailer as a link to the deployed task page, or bare. A job service: the walk, the review line and the issue body all stamp the same reference. */
export function loreTaskRef(taskId: string, uiUrl?: string): string {
  if (!uiUrl) {
    return taskId;
  }

  return `[${taskId}](${uiUrl.replace(/\/+$/, "")}/assembly-runs/${taskId})`;
}
