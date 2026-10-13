/** Crash-recovery for the bus: every 60 seconds, deliveries stuck in `processing` are made claimable again. Each is judged against its own subscriber's declared budget, so one process can do this for every subscriber (ADR-044). */
export function startDeliveryReaper(
  reapStuck: () => Promise<number>,
  intervalMs = 60_000,
): NodeJS.Timeout {
  console.log("[events] reaper started");

  return setInterval(() => {
    reapStuck()
      .then((n) => {
        if (n > 0) {
          console.log(`[events] reaped ${n} stuck delivery(ies)`);
        }
      })
      .catch((err) => console.error("[events] reaper failed:", err));
  }, intervalMs);
}
