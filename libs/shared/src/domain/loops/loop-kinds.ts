// The loops a repository can switch on and off, in the order the Loops tab shows them. A loop added later joins this tuple and `loopEnabled`, nothing else.

export const LOOP_KINDS = [
  {
    key: "implementation",
    label: "Implementation loop",
    description:
      "Works the repository's priority-labelled tickets one at a time and opens a pull request for each.",
  },
  {
    key: "review",
    label: "Code review",
    description:
      "Reviews every pull request when it opens and again on every push, and answers a request for changes from a trusted reviewer.",
  },
  {
    key: "merge",
    label: "Auto merge",
    description:
      "Takes every open pull request Lore's review passed, fixes red CI, conflicts and open review threads, and approves and merges it once it is green and has been open long enough.",
  },
  {
    key: "triage",
    label: "Issue triage",
    description:
      "Reads every issue labelled triage: needs-triage and labels, reproduces, decomposes or closes it.",
  },
  {
    key: "upkeep",
    label: "Spec upkeep",
    description:
      "Every Monday, finds spec statements that drifted from the code or have no test link, fixes them in one pull request and sees its CI through.",
  },
  {
    key: "digest",
    label: "Daily digest",
    description:
      "Posts what moved on the repository to its Slack channel, on the days and at the time its Settings page sets.",
  },
  {
    key: "tickets",
    label: "Spec tickets",
    description:
      "Every time a spec merges, splits it into a user story and task issues for the implementation loop, and rewrites the ones an earlier merge filed.",
  },
] as const;

export type LoopKind = (typeof LOOP_KINDS)[number];
export type LoopKey = LoopKind["key"];

export const LOOP_KEYS = LOOP_KINDS.map((kind) => kind.key) as [
  LoopKey,
  ...LoopKey[],
];

export function isLoopKey(value: unknown): value is LoopKey {
  return LOOP_KEYS.includes(value as LoopKey);
}

export function loopKind(key: LoopKey): LoopKind {
  return LOOP_KINDS.find((kind) => kind.key === key) as LoopKind;
}
