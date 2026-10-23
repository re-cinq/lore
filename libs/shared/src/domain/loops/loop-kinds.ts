// The loops a repository can switch on and off, in the order the Loops tab shows them. A loop added later (code review, auto merge, spec upkeep) joins this tuple and `loopEnabled`, nothing else.

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
      "Lore arms GitHub's auto-merge on its own pull requests that pass review; while this is on, lore-reviewer also approves them, so GitHub merges once the branch rule is met. While it is off, a person's approval is what merges them.",
  },
  {
    key: "triage",
    label: "Issue triage",
    description:
      "Reads every issue labelled triage: needs-triage and labels, reproduces, decomposes or closes it.",
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
