import { parse } from "yaml";

export interface SkillFile {
  name: string;
  title: string;
  description: string;
  model: string | null;
  content: string;
}

interface SkillFrontmatter {
  description?: string;
  model?: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;
const TITLE_HEADING = /^# (.+)$/m;

export function parseSkillFile(name: string, text: string): SkillFile {
  const frontmatter = readFrontmatter(text);

  return {
    name,
    title: TITLE_HEADING.exec(text)?.[1] ?? name,
    description: frontmatter.description?.trim() ?? "",
    model: frontmatter.model ?? null,
    content: text,
  };
}

function readFrontmatter(text: string): SkillFrontmatter {
  return parse(FRONTMATTER.exec(text)?.[1] ?? "") ?? {};
}
