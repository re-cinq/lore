import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/** YAML template loading + lookup — the ordered list of sections each named template assembles. */

export interface TemplateSection {
  header: string;
  source:
    | "repo"
    | "code"
    | "adrs"
    | "memories"
    | "graph"
    | "coupling"
    | "episodes"
    | "rules"
    | "cross_repo"
    | "incidents";
  priority: number;
  max_tokens?: number;
}

export interface Template {
  name: string;
  description: string;
  sections: TemplateSection[];
}

const templates = new Map<string, Template>();

function resolveTemplateDir(dir?: string): string {
  return dir || join(import.meta.dirname || process.cwd(), "..", "templates");
}

function loadTemplateFile(templateDir: string, file: string): void {
  try {
    const raw = readFileSync(join(templateDir, file), "utf-8");
    const template = parseYaml(raw) as Partial<Template>;

    if (template.name && template.sections) {
      templates.set(template.name, template as Template);
    }
  } catch (err) {
    console.warn(`[context-assembly] Failed to load template ${file}:`, err);
  }
}

export function loadTemplates(dir?: string): void {
  const templateDir = resolveTemplateDir(dir);

  if (!existsSync(templateDir)) {
    console.warn(
      `[context-assembly] Templates directory not found: ${templateDir}`,
    );

    return;
  }

  const files = readdirSync(templateDir).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );

  for (const file of files) {
    loadTemplateFile(templateDir, file);
  }
  console.log(
    `[context-assembly] Loaded ${templates.size} templates: ${[...templates.keys()].join(", ")}`,
  );
}

export function getTemplate(name: string): Template {
  return (
    templates.get(name) ||
    templates.get("default") || {
      name: "default",
      description: "Fallback template",
      sections: [
        { header: "Conventions", source: "repo" as const, priority: 1 },
        { header: "Agent Memory", source: "memories" as const, priority: 2 },
      ],
    }
  );
}
