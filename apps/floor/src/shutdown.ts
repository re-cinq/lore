// Coordinated shutdown for the Floor.
//
// Registering ANY signal handler overrides Node's default terminate, so a handler
// that does its job and returns leaves the process alive. The Floor had two —
// one stopping the HTTP server, one flushing telemetry — and neither exited, while
// the drain loop, scheduler and K8s watch kept the event loop busy forever. The
// result was a process that stopped serving and never died: locally a Floor that
// answers nothing while systemd reports it healthy, and in a rollout a pod that
// fails its liveness probe for the whole termination grace period.
//
// One handler, in order, then exit.

export interface ShutdownSteps {
  /** Stop accepting requests and drain in-flight ones. */
  stopServing: () => Promise<void>;
  /** Flush traces/metrics so the last moments of the process are not lost. */
  flushTelemetry: () => Promise<void>;
  exit: (code: number) => void;
}

/**
 * A shutdown function safe to wire to several signals.
 *
 * Every step is best-effort: a shutdown that cannot complete must still terminate,
 * or the zombie this exists to kill comes straight back. It runs once however many
 * signals arrive — a supervisor sending SIGTERM then SIGKILL, or a Ctrl-C landing
 * mid-drain, must not restart the sequence.
 */
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
