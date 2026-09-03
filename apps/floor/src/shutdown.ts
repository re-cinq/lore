// Coordinated shutdown for the Floor: registering ANY signal handler overrides Node's default terminate, so two prior handlers that stopped without exiting left a process that stopped serving but never died — one handler here, in order, then exit.

export interface ShutdownSteps {
  /** Stop accepting requests and drain in-flight ones. */
  stopServing: () => Promise<void>;
  /** Drain the event proxy's in-memory queue, resolving to what it could not deliver. Runs AFTER `stopServing` so an in-flight request's event reaches the queue first; before this step, a rollout took the backlog with it. */
  flushEvents?: () => Promise<number>;
  /** Flush traces/metrics so the last moments of the process are not lost. */
  flushTelemetry: () => Promise<void>;
  exit: (code: number) => void;
}

/** A shutdown function safe to wire to several signals. Every step is best-effort — a shutdown that cannot complete must still terminate — and it runs once however many signals arrive (SIGTERM then SIGKILL, or a Ctrl-C mid-drain, must not restart the sequence). */
export function createShutdown(
  steps: ShutdownSteps,
): (signal: string) => Promise<void> {
  let running: Promise<void> | null = null;

  return (signal: string) => {
    running ??= (async () => {
      console.log(`[floor] ${signal} — shutting down`);

      await steps
        .stopServing()
        .catch((err) =>
          console.warn(`[floor] stop failed: ${(err as Error).message}`),
        );
      const undrained = await steps.flushEvents?.().catch((err) => {
        console.warn(`[floor] event drain failed: ${(err as Error).message}`);

        return 0;
      });

      if (undrained) {
        console.error(
          `[floor] exiting with ${undrained} undelivered event(s) — the reconcile cron is what re-emits them`,
        );
      }
      await steps
        .flushTelemetry()
        .catch((err) =>
          console.warn(
            `[floor] telemetry flush failed: ${(err as Error).message}`,
          ),
        );

      steps.exit(0);
    })();

    return running;
  };
}
