import type { Project } from "@re-cinq/lore-shared";
import type { PrReadyCheckDeps } from "./sweep-contract.js";

type ThreadReads = Pick<
  PrReadyCheckDeps,
  | "listReviewThreads"
  | "filesChangedSince"
  | "replyToReviewComment"
  | "resolveReviewThread"
>;

/** The review threads and what settling an answered finding reads and writes: the files changed since it, the reply and the resolve. */
export function threadReads(
  projectOf: (repo: string) => Promise<Pick<Project, "pulls">>,
): ThreadReads {
  const pullsOf = async (repo: string) => (await projectOf(repo)).pulls;

  return {
    listReviewThreads: async (repo, number) =>
      (await pullsOf(repo)).listReviewThreads(number),
    filesChangedSince: async (repo, base, head) =>
      filenames(await (await pullsOf(repo)).netChange(base, head)),
    replyToReviewComment: async (repo, number, commentId, body) =>
      (await pullsOf(repo)).replyToReviewComment(number, commentId, body),
    resolveReviewThread: async (repo, threadId) =>
      (await pullsOf(repo)).resolveReviewThread(threadId),
  };
}

function filenames(files: Array<{ filename: string }> | null): string[] | null {
  return files?.map((file) => file.filename) ?? null;
}
