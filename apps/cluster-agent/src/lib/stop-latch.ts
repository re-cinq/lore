/** A loop's stop signal. Here rather than beside one loop, because the prune loop needs it too and reaching into the claim loop for it made `work` import `events`. */
export function stopLatch(): { running: () => boolean; stop: () => void } {
  let alive = true;

  return {
    running: () => alive,
    stop: () => {
      alive = false;
    },
  };
}
