import { z } from "zod";
import { enforceTrue } from "../../lib/enforce.js";
import {
  DigestGroupBySchema,
  DigestSectionSchema,
} from "../../domain/models/digest-settings.js";

/** The one module that wraps and unwraps `args.digest_repos`, the line-args string carrying which repos a channel's digest run covers and since when (specs/daily-digest FR10). */

export const DigestRepoSchema = z.object({
  repo: z.string().min(1),
  /** ISO timestamp the implemented window starts at. */
  since: z.string().min(1),
  sections: z.array(DigestSectionSchema),
  group_by: DigestGroupBySchema,
});

export type DigestRepo = z.infer<typeof DigestRepoSchema>;

export function encodeDigestRepos(repos: DigestRepo[]): string {
  return JSON.stringify(repos);
}

export function decodeDigestRepos(raw: string): DigestRepo[] {
  const parsed = z.array(DigestRepoSchema).safeParse(parseJson(raw));

  enforceTrue(
    parsed.success,
    Error,
    `digest_repos is not a list of digest repos: ${parsed.error?.message ?? ""}`,
  );

  return parsed.data;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
