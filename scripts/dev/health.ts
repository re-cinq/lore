export type Tone = "ok" | "wait" | "bad" | "dim";

export interface RowStatus {
  text: string;
  tone: Tone;
}

export const STARTUP_GRACE_MS = 30_000;

export function classifyHttp(
  httpStatus: number | null,
  ageMs: number,
): RowStatus {
  if (httpStatus !== null && httpStatus < 500) {
    return { text: "healthy", tone: "ok" };
  }

  if (httpStatus === null && ageMs < STARTUP_GRACE_MS) {
    return { text: "starting", tone: "wait" };
  }

  return { text: "down", tone: "bad" };
}

export function classifyDockerContainer(output: string): RowStatus {
  const state = output.trim();

  if (state === "healthy" || state === "true") {
    return { text: "healthy", tone: "ok" };
  }

  if (state === "starting") {
    return { text: "starting", tone: "wait" };
  }

  return { text: state === "" ? "not found" : state, tone: "bad" };
}

export function classifyMinikube(
  output: string,
  exitCode: number | null,
): RowStatus {
  if (exitCode === null) {
    return { text: "not installed", tone: "dim" };
  }
  const host = output.trim();

  if (host === "Running") {
    return { text: "running", tone: "ok" };
  }

  if (host === "Stopped") {
    return { text: "stopped", tone: "bad" };
  }

  return { text: host === "" ? "no profile" : host, tone: "bad" };
}

export function classifyDeployment(output: string): RowStatus {
  const readyOfDesired = /^(\d*)\/(\d+)$/.exec(output.trim());

  if (!readyOfDesired) {
    return { text: "unknown", tone: "bad" };
  }
  const ready = Number(readyOfDesired[1] || 0);
  const desired = Number(readyOfDesired[2]);
  const text = `${ready}/${desired}`;

  return ready >= 1 && ready === desired
    ? { text, tone: "ok" }
    : { text, tone: "wait" };
}
