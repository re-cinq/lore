import { spawn } from "node:child_process";

export interface CaptureResult {
  code: number | null;
  stdout: string;
  outputLines: string[];
}

export interface CaptureOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

// code is null when the program could not be started at all (not installed).
export function capture(
  command: string,
  args: string[],
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs,
    });
    const chunks: string[] = [];
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      chunks.push(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    child.on("error", () => resolve({ code: null, stdout, outputLines: [] }));
    child.on("close", (code) =>
      resolve({
        code,
        stdout,
        outputLines: chunks
          .join("")
          .split("\n")
          .filter((line) => line !== ""),
      }),
    );
  });
}
