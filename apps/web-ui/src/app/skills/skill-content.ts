const FRONTMATTER_BLOCK = /^---\n([\s\S]*?)\n---\n?/;
const TOP_LEVEL_KEY = /^([A-Za-z][\w-]*):/;
const FIELD_KEYS = new Set(["name", "description", "model"]);
const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 ,.()/'-]*$/;

export interface SkillContentParts {
  /** Frontmatter keys the form has no field for, kept as the raw lines they were stored in. */
  extraFrontmatter: string;
  /** The SKILL.md text below the frontmatter and the title heading. */
  body: string;
}

export interface SkillContentFields extends SkillContentParts {
  name: string;
  title: string;
  description: string;
  model: string;
}

export function splitSkillContent(content: string): SkillContentParts {
  const frontmatter = FRONTMATTER_BLOCK.exec(content);
  const afterFrontmatter = frontmatter
    ? content.slice(frontmatter[0].length)
    : content;

  return {
    extraFrontmatter: frontmatter ? extraKeys(frontmatter[1]) : "",
    body: withoutTitleHeading(afterFrontmatter),
  };
}

export function composeSkillContent(fields: SkillContentFields): string {
  const frontmatter = [
    `name: ${fields.name}`,
    fields.description && `description: ${yamlScalar(fields.description)}`,
    fields.model && `model: ${fields.model}`,
    fields.extraFrontmatter,
  ].filter(Boolean);

  return `---\n${frontmatter.join("\n")}\n---\n\n# ${fields.title}\n\n${fields.body}`;
}

function extraKeys(frontmatter: string): string {
  const extraLines: string[] = [];
  let keeping = false;

  for (const line of frontmatter.split("\n")) {
    const key = TOP_LEVEL_KEY.exec(line)?.[1];

    keeping = key === undefined ? keeping : !FIELD_KEYS.has(key);

    if (keeping) {
      extraLines.push(line);
    }
  }

  return extraLines.join("\n");
}

function withoutTitleHeading(text: string): string {
  const lines = text.replace(/^\s*\n/, "").split("\n");

  return lines[0].startsWith("# ")
    ? lines
        .slice(1)
        .join("\n")
        .replace(/^\s*\n/, "")
    : lines.join("\n");
}

function yamlScalar(text: string): string {
  return PLAIN_SCALAR.test(text) ? text : JSON.stringify(text);
}
