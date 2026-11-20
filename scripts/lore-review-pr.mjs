import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, parseArgs } from "node:util";
import { buildOctokit } from "../libs/shared/dist/outbound/project/lib/platform-github-auth.js";
import { PlatformGitHub } from "../libs/shared/dist/outbound/project/lib/platform-github.js";
import { githubHost } from "../libs/shared/dist/domain/github-host.js";
import {
  EvidenceLimit,
  discussionFor,
  productDocuments,
  productSpecs,
} from "./lore-review-pr-context.mjs";

import { storyPackets } from "./lore-review-packets.mjs";

const exec = promisify(execFile);
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const { values } = parseArgs({
  options: {
    since: { type: "string" },
    paths: { type: "string", multiple: true, default: [] },
    repo: { type: "string" },
    pr: { type: "string" },
    head: { type: "string" },
  },
});

function validateTarget() {
  if (
    (values.since !== undefined && !/^[0-9a-f]{40}$/.test(values.since)) ||
    !/^[\w.-]+\/[\w.-]+$/.test(values.repo ?? "") ||
    !/^[1-9]\d*$/.test(values.pr ?? "") ||
    !/^[0-9a-f]{40}$/.test(values.head ?? "")
  ) {
    throw new Error("Expected --repo owner/name --pr number --head full-sha");
  }
}

async function prepare(cwd) {
  const [owner, repo] = values.repo.split("/");
  const target = { owner, repo };
  const api = await buildOctokit(process.env);
  const pull = { ...target, pull_number: Number(values.pr) };
  const current = async () => (await api.rest.pulls.get(pull)).data;
  const pr = await current();

  if (pr.head.sha !== values.head || pr.state !== "open") {
    return { status: "superseded" };
  }
  const comparison = await api.rest.repos.compareCommitsWithBasehead({
    ...target,
    basehead: pr.base.sha + "..." + pr.head.sha,
    per_page: 1,
  });
  const mergeBase = comparison.data.merge_base_commit.sha;
  const evidenceBase = values.since ?? mergeBase;
  const host = githubHost();
  const token = await new PlatformGitHub().getInstallationToken(values.repo, {
    contents: "read",
  });

  if (!token) {
    throw new Error("GitHub returned no credential for the immutable snapshot");
  }
  const env = {
    PATH: process.env.PATH,
    HOME: cwd,
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  const options = { cwd, env, timeout: 120000, maxBuffer: 12 * 1024 * 1024 };
  const git = async (args) => (await exec("git", args, options)).stdout;

  await git(["init", "--bare", "--quiet"]);
  const authEnv = {
    ...env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.https://${host}/.extraheader`,
    GIT_CONFIG_VALUE_0:
      "Authorization: Basic " +
      Buffer.from("x-access-token:" + token).toString("base64"),
  };

  await exec(
    "git",
    [
      "-c",
      "http.followRedirects=false",
      "fetch",
      "--quiet",
      "--no-tags",
      "--depth=1",
      `https://${host}/${values.repo}.git`,
      ...new Set([mergeBase, evidenceBase, pr.head.sha, pr.base.sha]),
    ],
    { ...options, env: authEnv },
  );
  const [discussion, snapshot] = await Promise.all([
    discussionFor(api, target, pr),
    exec(
      process.execPath,
      [
        script("lore-review-snapshot.mjs"),
        "--base",
        pr.base.sha,
        "--head",
        pr.head.sha,
        "--github-merge-base",
        evidenceBase,
        ...values.paths.flatMap((path) => ["--scope", path]),
      ],
      options,
    ).then(
      ({ stdout }) => JSON.parse(stdout),
      (error) => {
        const refusal = JSON.parse(error.stdout);

        if (refusal.status === "whole_diff") {
          return refusal;
        }
        throw new Error(refusal.reason);
      },
    ),
  ]);

  if (snapshot.status) {
    return snapshot;
  }
  // A modified file goes to the readers as its diff and its new text: the old text in full doubles the packet.
  snapshot.files = await Promise.all(
    snapshot.files.map(async (file) =>
      file.before === null || file.after === null || file.before === file.after
        ? file
        : {
            ...file,
            diff: await git([
              "diff",
              "--no-ext-diff",
              "--no-color",
              evidenceBase,
              pr.head.sha,
              "--",
              ":(literal)" + file.path,
            ]),
          },
    ),
  );
  const product = await Promise.all([
    productSpecs(git, mergeBase, pr.head.sha, discussion, snapshot.files),
    productDocuments(git, evidenceBase, pr.head.sha, values.paths),
  ]).catch((error) => {
    if (error instanceof EvidenceLimit) {
      return { status: "whole_diff", reason: error.message };
    }
    throw error;
  });

  if (product.status) {
    return product;
  }
  const [specs, documents] = product;
  const latest = await current();

  if (
    latest.head.sha !== pr.head.sha ||
    latest.base.sha !== pr.base.sha ||
    latest.state !== "open"
  ) {
    return { status: "superseded" };
  }

  return { snapshot, discussion, specs, documents };
}

const cwd = await mkdtemp(join(tmpdir(), "lore-review-pr-"));

try {
  validateTarget();
  const prepared = await prepare(cwd);

  console.log(
    JSON.stringify(
      prepared.status
        ? prepared
        : storyPackets({
            ...prepared.snapshot,
            discussion: prepared.discussion,
            specs: prepared.specs,
            documents: prepared.documents,
          }),
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({ status: "incomplete", reason: error.message }),
  );
  process.exitCode = 1;
} finally {
  await rm(cwd, { recursive: true, force: true });
}
