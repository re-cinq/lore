const BACKTICKED_SKILL_MENTION = /`([a-z][a-z0-9-]*)` skill\b/g;
const RELATED_SLASH_NAME = /\/([a-z][a-z0-9-]*)/g;
const RELATED_LINE_PREFIX = "**Related:**";

export function referencedSkillNames(content: string): string[] {
  const mentioned = [...content.matchAll(BACKTICKED_SKILL_MENTION)].map(
    (match) => match[1],
  );
  const related = content
    .split("\n")
    .filter((line) => line.startsWith(RELATED_LINE_PREFIX))
    .flatMap((line) => [...line.matchAll(RELATED_SLASH_NAME)])
    .map((match) => match[1]);

  return [...new Set([...mentioned, ...related])];
}

const BACKTICKED_MARKDOWN_FILE = /`([A-Za-z0-9_./-]+\.md)`/g;

export function referencedMarkdownFiles(content: string): string[] {
  return [
    ...new Set(
      [...content.matchAll(BACKTICKED_MARKDOWN_FILE)].map((match) => match[1]),
    ),
  ];
}
