/**
 * A loop interval read from the environment, in one place.
 *
 * The claim loop and the heartbeat had this twice, and a rule they can disagree
 * on is a rule that will: `LORE_CLUSTER_AGENT_CLAIM_INTERVAL_S=0` and
 * `LORE_CLUSTER_AGENT_HEARTBEAT_S=0` should not mean different things.
 *
 * Anything that is not a positive finite number falls back to the default —
 * unset, empty, a typo, and zero alike, since a zero-second poll is a busy loop
 * against the API rather than a configuration anyone wants honoured.
 */
export function secondsEnvMs(
  raw: string | undefined,
  defaultS: number,
): number {
  const seconds = Number(raw);

  return (Number.isFinite(seconds) && seconds > 0 ? seconds : defaultS) * 1000;
}
