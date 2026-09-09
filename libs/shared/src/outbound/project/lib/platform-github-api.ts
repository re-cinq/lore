import type { Octokit } from "octokit";

/** The octokit sub-APIs the platform-github modules work through, so a helper's signature names the surface it can actually reach instead of the whole client. */
export type ReposApi = Octokit["rest"]["repos"];

export type IssuesApi = Octokit["rest"]["issues"];

export type PullsApi = Octokit["rest"]["pulls"];

export type GitApi = Octokit["rest"]["git"];

export type ChecksApi = Octokit["rest"]["checks"];
