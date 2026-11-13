import { parseSkillFile } from "./skill-file.js";
import { harnessOfModel } from "../domain/agents/model-harness.js";

const FRONTMATTER_BLOCK = /^---\n[\s\S]*?\n---/;
const MODEL_LINE = /^model:.*\n/m;

export function skillContentForModel(
  content: string,
  agentModel: string,
): string {
  const skillModel = parseSkillFile("", content).model;

  if (
    skillModel === null ||
    harnessOfModel(skillModel) === harnessOfModel(agentModel)
  ) {
    return content;
  }

  return content.replace(FRONTMATTER_BLOCK, (frontmatter) =>
    frontmatter.replace(MODEL_LINE, ""),
  );
}
