// Posting a channel's digest (specs/daily-digest FR7/FR9): the refined message the pod uploaded, or the stored draft when the agent failed or never reported. The run is CLAIMED in digest_posts before Slack is called, so the upload receiver and the run-closed fallback racing for one run post once; a claim whose Slack call failed is released so the next tick may try again.

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { DigestPostsPort } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-port.js";
import type { SlackPosterPort } from "@re-cinq/lore-shared/project/notify/slack-poster-port.js";
import {
  renderThreadParent,
  splitDigestMessage,
  stripAppendix,
} from "@re-cinq/lore-shared/digest/render.js";
import { splitForSlack } from "@re-cinq/lore-shared/digest/split-for-slack.js";
import { digestRunOf, type DigestRun } from "./digest-run.js";

/** A digest.md the supervisor uploaded after its agent exited; `exitCode` is null when the supervisor did not say. */
export interface DigestUpload {
  agentCrName: string;
  markdown: string;
  exitCode: number | null;
}

export interface DeliverDeps {
  posts: DigestPostsPort;
  poster: SlackPosterPort;
}

export interface UploadDeps extends DeliverDeps {
  runOfAgent(agentCrName: string): Promise<AssemblyRunRecord | null>;
}

export type DigestDelivery =
  | { outcome: "posted"; chunks: number }
  | { outcome: "already" }
  | { outcome: "skipped"; error: string };

export async function receiveDigestUpload(
  upload: DigestUpload,
  deps: UploadDeps,
): Promise<DigestDelivery> {
  const run = await deps.runOfAgent(upload.agentCrName);

  if (!run) {
    return { outcome: "skipped", error: "no digest run knows this agent" };
  }

  return deliverDigestRun(run, upload, deps);
}

const NOTHING_TO_POST: DigestDelivery = {
  outcome: "skipped",
  error: "the run has neither a message nor a draft",
};

/** With no upload (the run closed without one), the stored draft is what gets posted; with nothing stored either, the pod never even asked for its draft and there is nothing to say. */
export async function deliverDigestRun(
  run: AssemblyRunRecord,
  upload: Pick<DigestUpload, "markdown" | "exitCode"> | null,
  deps: DeliverDeps,
): Promise<DigestDelivery> {
  const digest = digestRunOf(run);

  if (!digest) {
    return { outcome: "skipped", error: "not a digest run" };
  }
  const message = messageOf(digest, upload);

  if (message === null) {
    return NOTHING_TO_POST;
  }

  if (!(await claimRun(digest, deps.posts))) {
    return { outcome: "already" };
  }

  return postClaimed(digest, message, deps);
}

/** One row per repo of the run; false when another delivery already claimed it. */
function claimRun(digest: DigestRun, posts: DigestPostsPort): Promise<boolean> {
  return posts.claim(
    digest.id,
    digest.repos.map(({ repo }) => ({
      repo,
      channelId: digest.channel,
      weekKey: digest.weekKey,
    })),
  );
}

/** The agent's file when it exited well and wrote something; the draft otherwise. */
function messageOf(
  digest: DigestRun,
  upload: Pick<DigestUpload, "markdown" | "exitCode"> | null,
): string | null {
  const refined =
    upload !== null && (upload.exitCode ?? 0) === 0 && upload.markdown.trim();

  if (refined) {
    return upload.markdown.trim();
  }

  return digest.draft ? stripAppendix(digest.draft) : null;
}

async function postClaimed(
  digest: DigestRun,
  message: string,
  deps: DeliverDeps,
): Promise<DigestDelivery> {
  try {
    const threadTs = await threadOf(digest, deps);
    const chunks = splitForSlack(message);

    await postChunks(digest.channel, threadTs, chunks, deps.poster);
    const { intro, ending } = splitDigestMessage(message);

    await deps.posts.finish(digest.id, { threadTs, intro, ending });

    return { outcome: "posted", chunks: chunks.length };
  } catch (err) {
    await deps.posts.release(digest.id);
    throw err;
  }
}

/** The week's thread, opened with its parent on the week's first post. */
async function threadOf(digest: DigestRun, deps: DeliverDeps): Promise<string> {
  const existing = await deps.posts.threadFor(digest.channel, digest.weekKey);

  if (existing) {
    return existing.threadTs;
  }
  const parent = await deps.poster.post({
    channel: digest.channel,
    text: renderThreadParent(
      digest.weekKey,
      digest.repos.map((r) => r.repo),
    ),
  });

  return parent.ts;
}

/** Consecutive replies in the thread; only the first is broadcast to the channel (FR8). Sequential on purpose: Slack orders replies by arrival. */
async function postChunks(
  channel: string,
  threadTs: string,
  chunks: string[],
  poster: SlackPosterPort,
): Promise<void> {
  for (const [index, text] of chunks.entries()) {
    await poster.post({ channel, text, threadTs, replyBroadcast: index === 0 });
  }
}
