// A loop interval read from the environment, in one place — a non-positive-finite value (unset, typo, or 0) falls back to the default rather than becoming a busy loop.
export function secondsEnvMs(
  raw: string | undefined,
  defaultS: number,
): number {
  const seconds = Number(raw);

  return (Number.isFinite(seconds) && seconds > 0 ? seconds : defaultS) * 1000;
}
