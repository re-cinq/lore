// Process lifecycle a service entrypoint owns: both termination signals reach one shutdown, and a boot that never finishes exits non-zero rather than leaving a pod that answers nothing.

/** The signal name is passed on so the shutdown log says which one arrived. */
export function onTerminationSignals(
  shutdown: (signal: string) => Promise<void>,
): void {
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export function runEntrypoint(label: string, main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    console.error(`[${label}] fatal:`, err);
    process.exit(1);
  });
}
