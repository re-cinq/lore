import { enforceTrue } from "../../lib/enforce.js";
import type { GitPort } from "./git-port.js";
import type { PullRequestsPort, PullRef } from "../pulls/pull-requests-port.js";

/**
 * A cloned working tree. Stateful — owns the branch + file-write state for one
 * checkout so the logical Project stays stateless. openPr pushes then delegates
 * to the canonical pulls port (Workspace.openPr is the push-then-open
 * convenience). Returned only by Project.cache(), so writes require a clone.
 */
export class Workspace {
  constructor(
    readonly repo: string,
    readonly dir: string,
    private readonly git: GitPort,
    private readonly pulls?: PullRequestsPort,
  ) {}

  getBranches(): Promise<string[]> {
    return this.git.listBranches(this.dir);
  }

  switchBranch(branch: string, opts?: { create?: boolean }): Promise<void> {
    return this.git.switchBranch(this.dir, branch, opts);
  }

  readFile(path: string): Promise<string> {
    return this.git.readFile(this.dir, path);
  }

  writeFile(path: string, content: string): Promise<void> {
    return this.git.writeFile(this.dir, path, content);
  }

  commit(message: string): Promise<{ committed: boolean }> {
    return this.git.stageCommit(this.dir, message);
  }

  push(branch: string): Promise<void> {
    return this.git.push(this.dir, branch);
  }

  async openPr(
    branch: string,
    title: string,
    body: string,
    base?: string,
  ): Promise<PullRef> {
    enforceTrue(
      this.pulls,
      Error,
      "This Workspace has no pulls port to open a PR",
    );
    await this.git.push(this.dir, branch);

    return this.pulls.open(this.repo, branch, { title, body, base });
  }

  dispose(): Promise<void> {
    return this.git.remove(this.dir);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}
