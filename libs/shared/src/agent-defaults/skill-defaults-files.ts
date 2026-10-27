import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFile, type SkillFile } from "./skill-file.js";

export const SHIPPED_SKILLS_DIR = fileURLToPath(
  new URL("./skills/", import.meta.url),
);

export function loadSkillDefaults(
  dir: string = SHIPPED_SKILLS_DIR,
): SkillFile[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) =>
      parseSkillFile(
        basename(file, ".md"),
        readFileSync(join(dir, file), "utf-8"),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
