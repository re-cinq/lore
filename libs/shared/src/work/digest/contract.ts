/** The names the daily digest's line, recipe and Floor routes agree on (specs/daily-digest FR10); spelled once so a mismatch fails to compile instead of silently serving nothing. */

export const DAILY_DIGEST_LINE = "daily-digest";

/** The recipe's `inputs[].source`: what the Floor serves as the pod's `digest-draft.md`. */
export const DIGEST_DRAFT_SOURCE = "digest-draft";

/** The recipe's `watch.event`: the uploaded `digest.md` the Floor posts to Slack. */
export const DIGEST_MESSAGE_EVENT = "digest.message";

/** How many recent intros and endings ride in the draft's appendix. */
export const RECENT_TEXTS_LIMIT = 14;

/** A channel starts at most this many digest runs a day; a dead pod writes no watermark, and this is what keeps the tick from respawning it all day. */
export const MAX_RUNS_PER_CHANNEL_DAY = 3;
