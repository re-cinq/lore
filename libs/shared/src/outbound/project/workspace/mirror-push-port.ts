export interface MirrorPushRequest {
  sourceUrl: string;
  sourceAuthArgs: string[];
  targetUrl: string;
  targetAuthArgs: string[];
  sha: string;
  tag: string;
}

export type MirrorPushOutcome =
  | { kind: "pushed"; sha: string; tag: string }
  | { kind: "already-up-to-date"; sha: string; tag: string }
  | { kind: "target-diverged"; targetHead: string }
  | { kind: "tag-at-other-sha"; tagSha: string };

export interface MirrorPushPort {
  push(request: MirrorPushRequest): Promise<MirrorPushOutcome>;
}
