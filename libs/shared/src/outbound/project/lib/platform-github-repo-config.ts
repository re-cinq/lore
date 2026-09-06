import type { Octokit } from "octokit";
import type { CheckRunInput } from "./github-port.js";
import { split } from "./platform-github-support.js";

/** Repo-level config writes (Actions variables/secrets, check runs) — consumed by the settings adapter. */

export async function upsertCheckRun(
  ok: Octokit,
  repo: string,
  input: CheckRunInput,
): Promise<void> {
  const [owner, name] = split(repo);
  const { data: checks } = await ok.rest.checks.listForRef({
    owner,
    repo: name,
    ref: input.headSha,
    check_name: input.name,
  });
  const existing = checks.check_runs.at(0);
  const output = { title: input.title, summary: input.summary };
  const fields = {
    status: input.status,
    ...(input.conclusion ? { conclusion: input.conclusion } : {}),
    ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
    output,
  };

  if (existing) {
    await ok.rest.checks.update({
      owner,
      repo: name,
      check_run_id: existing.id,
      ...fields,
    });

    return;
  }
  await ok.rest.checks.create({
    owner,
    repo: name,
    name: input.name,
    head_sha: input.headSha,
    ...fields,
  });
}

export async function setRepoVariable(
  ok: Octokit,
  repo: string,
  name: string,
  value: string,
): Promise<void> {
  const [owner, repoName] = split(repo);

  try {
    await ok.rest.actions.updateRepoVariable({
      owner,
      repo: repoName,
      name,
      value,
    });
  } catch {
    await ok.rest.actions.createRepoVariable({
      owner,
      repo: repoName,
      name,
      value,
    });
  }
}

interface Sodium {
  ready: Promise<void>;
  base64_variants: { ORIGINAL: number };
  from_base64(input: string, variant: number): Uint8Array;
  from_string(input: string): Uint8Array;
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  to_base64(input: Uint8Array, variant: number): string;
}

export async function setRepoSecret(
  ok: Octokit,
  repo: string,
  name: string,
  value: string,
): Promise<void> {
  const [owner, repoName] = split(repo);
  const { data: pubKey } = await ok.rest.actions.getRepoPublicKey({
    owner,
    repo: repoName,
  });
  // Indirected through a variable so tsc doesn't demand a declaration file; runtime-deps.test.ts pins it as a production dep of libs/shared instead.
  const spec = "libsodium-wrappers";
  const sodium = ((await import(spec)) as { default: Sodium }).default;

  await sodium.ready;
  const keyBytes = sodium.from_base64(
    pubKey.key,
    sodium.base64_variants.ORIGINAL,
  );
  const encrypted = sodium.crypto_box_seal(sodium.from_string(value), keyBytes);
  const encryptedValue = sodium.to_base64(
    encrypted,
    sodium.base64_variants.ORIGINAL,
  );

  await ok.rest.actions.createOrUpdateRepoSecret({
    owner,
    repo: repoName,
    secret_name: name,
    encrypted_value: encryptedValue,
    key_id: pubKey.key_id,
  });
}
