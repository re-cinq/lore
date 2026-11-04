// The repository paths the model may choose files from: the ones the query names, then the ones sharing most words with the task, so a pick is always a real path.

export interface CandidateAsk {
  text: string;
  named: string[];
  limit: number;
}

const MIN_WORD = 4;

export function candidatePaths(tree: string[], ask: CandidateAsk): string[] {
  const held = new Set(tree);
  const words = taskWords(ask.text);
  const ranked = tree
    .map((path) => ({ path, score: sharedWords(path, words) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .map((entry) => entry.path);
  const named = ask.named.filter((path) => held.has(path));

  return [...new Set([...named, ...ranked])].slice(0, ask.limit);
}

/** The repository's top-level folders and files: the primer of a repository with nothing written about itself. */
export function topLevelEntries(tree: string[]): string[] {
  return [...new Set(tree.map((path) => path.split("/")[0]))].sort();
}

function taskWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= MIN_WORD),
    ),
  ];
}

function sharedWords(path: string, words: string[]): number {
  const lowered = path.toLowerCase();

  return words.filter((word) => lowered.includes(word)).length;
}
