// The loops a repository can switch on and off, in the order the Loops tab shows them. A loop added later (code review, auto merge, spec upkeep) joins this tuple and `loopEnabled`, nothing else.

export const LOOP_KINDS = [
  {
    key: "implementation",
    label: "Implementation loop",
    description:
      "Works the repository's priority-labelled tickets one at a time and opens a pull request for each.",
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
