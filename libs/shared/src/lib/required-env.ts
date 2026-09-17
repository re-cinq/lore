/** Deployment configuration is supplied, never guessed. A code default for a host, a port or a bucket turns a broken deployment into a process that boots and quietly talks to the wrong thing — the shape of the 2026-08-24 credential outage — so a missing value fails at boot instead. Values with a genuine off position (feature flags, tuning knobs) keep their defaults and do not belong here. */

import { enforceTrue } from "./enforce.js";

export function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];

  enforceTrue(
    value,
    Error,
    `${name} is not set — the deployment must supply it`,
  );

  return value;
}

/** A port the deployment names. Refuses a non-numeric value rather than passing `NaN` to `listen`, which binds a random port and reads as "started". */
export function requiredPort(env: NodeJS.ProcessEnv, name: string): number {
  const raw = requiredEnv(env, name);
  const port = Number.parseInt(raw, 10);

  enforceTrue(
    Number.isInteger(port),
    Error,
    `${name} must be a number, got "${raw}"`,
  );

  return port;
}
