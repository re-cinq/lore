import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";

export interface RelayResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Kernel-side driver for the BYO toolchain relay (ADR-025). Runs in the kernel
 * container and dispatches commands to the relay loop ({@link RELAY_SCRIPT})
 * in the repo's container over the shared control directory. See `relay-script.ts`
 * for the on-disk protocol.
 */
export class RelayExecutor {
  private seq = 0;

  constructor(
    private readonly dir: string,
    private readonly opts: { timeoutMs?: number; pollMs?: number } = {},
  ) {}

  /** Run a command in the BYO container's toolchain; resolves with its result. */
  async run(command: string): Promise<RelayResult> {
    const n = ++this.seq;
    await mkdir(this.dir, { recursive: true });
    // Write the command body first, then the .ready marker, so the relay never
    // picks up a partially-written request.
    await writeFile(join(this.dir, `req-${n}.sh`), command);
    await writeFile(join(this.dir, `req-${n}.ready`), "");

    await this.waitFor(join(this.dir, `res-${n}.done`));

    const code = Number(
      (await readFile(join(this.dir, `res-${n}.code`), "utf8")).trim(),
    );
    const stdout = await readFile(join(this.dir, `res-${n}.out`), "utf8");
    const stderr = await readFile(join(this.dir, `res-${n}.err`), "utf8");
    return { exitCode: Number.isNaN(code) ? -1 : code, stdout, stderr };
  }

  /** Signal the relay to exit, terminating the BYO sidecar. */
  async shutdown(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, "shutdown"), "");
  }

  private async waitFor(path: string): Promise<void> {
    const timeoutMs = this.opts.timeoutMs ?? 600_000;
    const pollMs = this.opts.pollMs ?? 100;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await access(path);
        return;
      } catch {
        /* not ready yet */
      }
      if (Date.now() > deadline) {
        throw new Error(`relay command timed out after ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}
