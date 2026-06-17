import { spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  stationPlainEnv,
  type LoreTaskSpec,
  type StationBackend,
  type StationLaunchResult,
  type StationCredentials,
  type StationMount,
} from "@re-cinq/lore-shared";

/**
 * Docker Station backend (ADR-028) for local dev — runs the SAME claude-runner
 * image as the GKE Job pod via `docker run`, no Kubernetes. Synchronous: it waits
 * on the container and resolves `completion` (exit code + the `CHANGES=N` marker
 * the entrypoint emits) so the caller can finalize the run inline (there is no
 * loretask-watcher locally). `feature-planning` self-POSTs its result and exits
 * CHANGES=0, so the backend just runs it.
 *
 * Credentials (git token + LLM auth) are INJECTED via {@link StationCredentials}
 * — the backend never hardcodes how they're obtained, so local dev can use the
 * developer's `gh` token + claude config. Secrets are passed by-reference
 * (`-e NAME`, value inherited from the docker process env) so they never appear
 * in argv / `ps`.
 */

const DEFAULT_IMAGE = "lore-claude-runner:local";

export interface DockerRunInput {
  image: string;
  name: string;
  network: string;
  /** Literal plain (non-secret) env vars → `-e NAME=value`. */
  env: Record<string, string>;
  /** Secret env var names → `-e NAME` (value inherited from the docker process env). */
  secretEnvNames: string[];
  /** Read-only volume mounts (e.g. the host claude config for LLM auth). */
  mounts: StationMount[];
}

/** Pure: the `docker` argv for one Station run. Unit-tested. */
export function buildDockerRunArgs(input: DockerRunInput): string[] {
  const args = ["run", "--rm", "--name", input.name, "--network", input.network];
  for (const [name, value] of Object.entries(input.env)) args.push("-e", `${name}=${value}`);
  for (const name of input.secretEnvNames) args.push("-e", name);
  for (const m of input.mounts) {
    const mode = m.readOnly === false ? "rw" : "ro";
    args.push("-v", `${m.hostPath}:${m.containerPath}:${mode}`);
  }
  args.push(input.image);
  return args;
}

/** Pure: parse the `CHANGES=N` marker the entrypoint emits. */
export function parseChanges(stdout: string): number {
  const m = stdout.match(/CHANGES=\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

export class DockerStation implements StationBackend {
  constructor(
    private readonly creds: StationCredentials,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    const name = spec.name ?? `loretask-${spec.taskId.substring(0, 8)}`;

    const plain: Record<string, string> = Object.fromEntries(
      stationPlainEnv(spec).map((e) => [e.name, e.value]),
    );
    plain.LORE_API_URL = this.env.LORE_API_URL ?? "http://localhost:3001";

    // Git token (clone/push) — injected, not hardcoded.
    const gitToken = await this.creds.gitToken();
    if (!gitToken) {
      throw new Error(
        "Docker Station: no git token — set GITHUB_TOKEN, run `gh auth login`, or configure a GitHub App. See ADR-028.",
      );
    }
    const childEnv: NodeJS.ProcessEnv = { ...this.env, GITHUB_TOKEN: gitToken };
    const secretEnvNames = ["GITHUB_TOKEN"];
    if (this.env.LORE_INGEST_TOKEN) secretEnvNames.push("LORE_INGEST_TOKEN");

    // LLM auth — injected: an API key (preferred) and/or config mounts.
    const llm = await this.creds.llm();
    const mounts: StationMount[] = [];
    if (llm.apiKey) {
      childEnv.ANTHROPIC_API_KEY = llm.apiKey;
      secretEnvNames.push("ANTHROPIC_API_KEY");
    } else if (llm.mounts && llm.mounts.length > 0) {
      mounts.push(...llm.mounts);
    } else {
      throw new Error(
        "Docker Station: no LLM credential. Set ANTHROPIC_API_KEY in .env.local for org billing " +
          "(recommended — same as the cluster), or set LORE_STATION_ALLOW_PERSONAL_AUTH=1 to use your " +
          "personal Claude subscription via ~/.claude (burns your personal quota). See ADR-028.",
      );
    }

    // Persistent repo cache (GitLab GIT_STRATEGY=fetch model): a per-repo host dir
    // mounted RW at /workspace/repo. The entrypoint fetch-or-clones into it +
    // clean/reset for a pristine tree, so rounds after the first skip the full
    // clone. The Floor worker runs Stations serially, so a per-repo dir can't
    // race. Pre-created here (same uid 1000 as the container's `node` user → writable).
    mounts.push({ hostPath: this.repoCacheDir(spec.targetRepo), containerPath: "/workspace/repo", readOnly: false });

    const args = buildDockerRunArgs({
      image: this.env.LORE_RUNNER_IMAGE ?? DEFAULT_IMAGE,
      name,
      network: "host",
      env: plain,
      secretEnvNames,
      mounts,
    });

    const { exitCode, output } = await this.runDocker(args, childEnv);
    return {
      ref: name,
      launched: true,
      completion: { exitCode, changedFiles: parseChanges(output), output },
    };
  }

  /** Per-repo persistent cache dir, pre-created so the container (uid 1000) can write it. */
  private repoCacheDir(targetRepo: string): string {
    const base = this.env.LORE_STATION_CACHE_DIR ?? path.join(os.homedir(), ".lore", "station-repos");
    const dir = path.join(base, targetRepo.replace(/[^a-zA-Z0-9._-]+/g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private runDocker(
    args: string[],
    env: NodeJS.ProcessEnv,
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", args, { env });
      let output = "";
      const onData = (b: Buffer) => {
        const s = b.toString();
        output += s;
        process.stdout.write(`[docker-station] ${s}`);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", reject);
      child.on("close", (code) => resolve({ exitCode: code ?? 1, output }));
    });
  }
}
