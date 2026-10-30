import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

type Env = Record<string, string>;

function bashEnvironment(script: string, envFilePath: string): string {
  const result = spawnSync("bash", ["-c", script, "_", envFilePath], {
    env: {},
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `${envFilePath} could not be sourced by bash: ${result.stderr.trim()}`,
    );
  }

  return result.stdout;
}

export function parseNulSeparatedEnv(output: string): Env {
  const entries = output
    .split("\0")
    .filter((entry) => entry.includes("="))
    .map((entry): [string, string] => {
      const separator = entry.indexOf("=");

      return [entry.slice(0, separator), entry.slice(separator + 1)];
    });

  return Object.fromEntries(entries);
}

// Bash adds variables of its own (PWD, SHLVL, and whatever the distro's bashrc sets) even with an empty environment; only what the file changed counts.
export function loadEnvFile(envFilePath: string): Env {
  if (!existsSync(envFilePath)) {
    return {};
  }
  const baseline = parseNulSeparatedEnv(bashEnvironment("env -0", envFilePath));
  const sourced = parseNulSeparatedEnv(
    bashEnvironment('set -ae; . "$1"; env -0', envFilePath),
  );

  return Object.fromEntries(
    Object.entries(sourced).filter(([key, value]) => baseline[key] !== value),
  );
}
