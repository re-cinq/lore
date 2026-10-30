import { capture } from "./exec.ts";

export interface FreedPort {
  port: number;
  pids: number[];
}

const POLL_INTERVAL_MS = 300;
const POLL_ATTEMPTS = 5;

export async function listeningPids(port: number): Promise<number[]> {
  const listing = await capture("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);

  const { stdout } = listing;
  const pids = stdout.split("\n").filter((line) => line !== "");

  return pids.map(Number).filter((pid) => pid !== process.pid);
}

export async function isLsofInstalled(): Promise<boolean> {
  return (await capture("lsof", ["-v"])).code !== null;
}

function signalAll(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // the process exited between the listing and the signal
    }
  }
}

async function freePort(port: number, pids: number[]): Promise<void> {
  signalAll(pids, "SIGTERM");

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    if ((await listeningPids(port)).length === 0) {
      return;
    }
  }
  signalAll(await listeningPids(port), "SIGKILL");
}

// node --watch children ignore plain SIGTERM, so a held port needs the SIGKILL fallback.
export async function freePorts(ports: number[]): Promise<FreedPort[]> {
  const freed: FreedPort[] = [];

  for (const port of ports) {
    const pids = await listeningPids(port);

    if (pids.length === 0) {
      continue;
    }
    await freePort(port, pids);
    freed.push({ port, pids });
  }

  return freed;
}
