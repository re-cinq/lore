import { readFileSync, existsSync } from "fs";

interface DelegateContext {
  pipeline_task_id?: string;
  spec_file?: boolean;
  branch?: string;
  seed_query?: string;
}

const SPEC_FILES = [".specify/spec.md", ".specify/constitution.md"];

function pipelineTaskSection(taskId?: string): string | null {
  return taskId ? `## Pipeline task\nTask ID: ${taskId}` : null;
}

function specFileLabel(file: string): string {
  return file.includes("spec") ? "Spec" : "Constitution";
}

function specFileSections(): string[] {
  return SPEC_FILES.filter((file) => existsSync(file)).map(
    (file) => `## ${specFileLabel(file)}\n${readFileSync(file, "utf8")}`,
  );
}

function seedQuerySection(seedQuery?: string): string | null {
  return seedQuery ? `## Seed query\n${seedQuery}` : null;
}

function branchSection(branch?: string): string | null {
  return branch ? `## Branch\n${branch}` : null;
}

export async function buildContextBundle(
  context?: DelegateContext,
): Promise<string> {
  const { pipeline_task_id, spec_file, seed_query, branch } = context ?? {};
  const parts: Array<string | null> = [
    pipelineTaskSection(pipeline_task_id),
    ...(spec_file ? specFileSections() : []),
    seedQuerySection(seed_query),
    branchSection(branch),
  ];

  return parts
    .filter((part): part is string => part !== null)
    .join("\n\n---\n\n");
}
