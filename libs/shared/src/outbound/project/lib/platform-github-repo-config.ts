import type { Octokit } from "octokit";
import type { CheckRunInput } from "./github-port.js";
import { split } from "./platform-github-support.js";

/** Repo-level config writes (Actions variables/secrets, check runs) — consumed by the settings adapter. */

/** The mutable half of a check run — the same payload whether it is being created or updated. Conclusion and details URL are omitted while absent: a check still in progress has no conclusion, and sending an empty one would fail the call. */
function checkRunFields(input: CheckRunInput) {
  return {
    status: input.status,
    ...(input.conclusion ? { conclusion: input.conclusion } : {}),
    ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
    output: { title: input.title, summary: input.summary },
  };
}

/** The check run this commit already carries under this name, if any. Keyed on head sha AND name so a re-run updates its own row instead of stacking a second check beside it. */
async function findCheckRun(
  ok: Octokit,
  { owner, name }: { owner: string; name: string },
  input: CheckRunInput,
) {
  const { data: checks } = await ok.rest.checks.listForRef({
    owner,
    repo: name,
    ref: input.headSha,
    check_name: input.name,
  });

  return checks.check_runs.at(0);
}

export async function upsertCheckRun(
  ok: Octokit,
  repo: string,
  input: CheckRunInput,
): Promise<void> {
  const [owner, name] = split(repo);
  const existing = await findCheckRun(ok, { owner, name }, input);

  if (existing) {
    await updateCheckRun(ok, { owner, name }, existing.id, input);

    return;
  }
  await createCheckRun(ok, { owner, name }, input);
}

/** Rewrites the check run this commit already carries, leaving its identity (sha + name) alone. */
async function updateCheckRun(
  ok: Octokit,
  { owner, name }: { owner: string; name: string },
  checkRunId: number,
  input: CheckRunInput,
): Promise<void> {
  await ok.rest.checks.update({
    owner,
    repo: name,
    check_run_id: checkRunId,
    ...checkRunFields(input),
  });
}

/** Files the first check run for this sha under this name. */
async function createCheckRun(
  ok: Octokit,
  { owner, name }: { owner: string; name: string },
  input: CheckRunInput,
): Promise<void> {
  await ok.rest.checks.create({
    owner,
    repo: name,
    name: input.name,
    head_sha: input.headSha,
    ...checkRunFields(input),
  });
}

export async function setRepoVariable(
  ok: Octokit,
  repo: string,
  name: string,
  value: string,
): Promise<void> {
  const [owner, repoName] = split(repo);
  const variable = { owner, repo: repoName, name, value };

  try {
    await ok.rest.actions.updateRepoVariable(variable);
  } catch {
    await ok.rest.actions.createRepoVariable(variable);
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

/** The value sealed to the repo's Actions public key. GitHub never accepts a plaintext secret — the box is built client-side, so the value in flight is already unreadable to anything but that repo. */
async function sealForRepo(value: string, publicKey: string): Promise<string> {
  // Indirected through a variable so tsc doesn't demand a declaration file; runtime-deps.test.ts pins it as a production dep of libs/shared instead.
  const spec = "libsodium-wrappers";
  const sodium = ((await import(spec)) as { default: Sodium }).default;

  await sodium.ready;
  const sealed = sodium.crypto_box_seal(
    sodium.from_string(value),
    sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL),
  );

  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
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

  await ok.rest.actions.createOrUpdateRepoSecret({
    owner,
    repo: repoName,
    secret_name: name,
    encrypted_value: await sealForRepo(value, pubKey.key),
    key_id: pubKey.key_id,
  });
}
