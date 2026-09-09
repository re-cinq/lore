/** The hapi bootstrap every Lore service shares: record the 500s, listen, and say why it could not. */

import type { Server } from "@hapi/hapi";

/** A throw inside a handler or auth strategy becomes an anonymous 500 (#1319); this is the only place the stack is recorded, and the `error` channel fires for both. */
export function logRequestErrors(server: Server): void {
  server.events.on({ name: "request", channels: "error" }, (request, event) => {
    const err = event.error;
    const detail = err instanceof Error ? (err.stack ?? err.message) : `${err}`;

    console.error(
      `[http] ${request.method.toUpperCase()} ${request.path} 500 (${request.info.id}): ${detail}`,
    );
  });
}

// EADDRINUSE gets its own line because it has a cause a person can act on — another instance is already running — while anything else is reported with the error itself.
function bootFailure(label: string, port: number, err: unknown): unknown[] {
  return (err as NodeJS.ErrnoException | null | undefined)?.code ===
    "EADDRINUSE"
    ? [
        `[${label}] port ${port} already in use — another instance is running. Exiting.`,
      ]
    : [`[${label}] server error:`, err];
}

export interface ServerBoot {
  /** Prefixes every line this boot writes, so a pod's logs name the service that failed. */
  label: string;
  port: number;
  /** Logged once listening — each service says what it is now serving. */
  ready: string;
}

export async function startHapiServer(
  server: Server,
  boot: ServerBoot,
): Promise<() => Promise<void>> {
  try {
    await server.start();
    console.log(`[${boot.label}] ${boot.ready}`);

    return () => server.stop();
  } catch (err) {
    console.error(...bootFailure(boot.label, boot.port, err));
    process.exit(1);
  }
}
