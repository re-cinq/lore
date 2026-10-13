import { enforceTrue } from "../lib/enforce.js";

/** The longest description a task may carry. Every writer checks against this one value, because a caller that builds its own text under a looser cap mints tasks creation refuses: the implementation loop truncated tickets at 16,000 while creation refused past 10,000, and re-cinq/Otto's backlog froze for two days on one 10,792-char issue. */
export const MAX_TASK_DESCRIPTION_CHARS = 32_000;

export function enforceDescriptionFits(description: string): void {
  enforceTrue(
    description.length <= MAX_TASK_DESCRIPTION_CHARS,
    Error,
    `Description too long (max ${MAX_TASK_DESCRIPTION_CHARS} chars)`,
  );
}
