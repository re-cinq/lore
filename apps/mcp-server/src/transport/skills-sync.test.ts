import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SkillDefinition } from "@re-cinq/lore-shared/models/skill-definition.js";
import {
  applySkillSync,
  planSkillSync,
  readLocalSkillDirs,
} from "./skills-sync.js";

function skill(name: string): SkillDefinition {
  return {
    name,
    title: name,
    description: "",
    model: null,
    content: `# ${name}`,
    enabled: true,
    projectId: null,
  };
}

function switchedOffSkill(name: string): SkillDefinition {
  return { ...skill(name), enabled: false };
}

describe("planSkillSync", () => {
  it("writes tdd-loop when it is enabled and absent locally", () => {
    expect(planSkillSync([skill("tdd-loop")], [])).toEqual({
      write: [skill("tdd-loop")],
      remove: [],
    });
  });

  it("leaves a hand-installed tdd-loop directory alone", () => {
    expect(
      planSkillSync(
        [skill("tdd-loop")],
        [{ name: "tdd-loop", managed: false }],
      ),
    ).toEqual({ write: [], remove: [] });
  });

  it("removes a managed tdd-loop once it is disabled upstream", () => {
    expect(
      planSkillSync(
        [switchedOffSkill("tdd-loop")],
        [{ name: "tdd-loop", managed: true }],
      ),
    ).toEqual({ write: [], remove: ["tdd-loop"] });
  });

  it("removes a managed old-skill that was deleted upstream and keeps an unmanaged mine", () => {
    expect(
      planSkillSync(
        [],
        [
          { name: "old-skill", managed: true },
          { name: "mine", managed: false },
        ],
      ),
    ).toEqual({ write: [], remove: ["old-skill"] });
  });

  it("skips a skill named ../escape", () => {
    expect(planSkillSync([skill("../escape")], [])).toEqual({
      write: [],
      remove: [],
    });
  });
});

describe("applySkillSync", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-sync-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes SKILL.md with a marker for tdd-loop and removes the managed old-skill", async () => {
    await fs.mkdir(path.join(dir, "old-skill"));
    await fs.writeFile(path.join(dir, "old-skill", ".lore-managed"), "");
    await fs.mkdir(path.join(dir, "mine"));

    await applySkillSync(dir, {
      write: [skill("tdd-loop")],
      remove: ["old-skill"],
    });

    expect({
      dirs: (await readLocalSkillDirs(dir)).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      content: await fs.readFile(
        path.join(dir, "tdd-loop", "SKILL.md"),
        "utf8",
      ),
    }).toEqual({
      dirs: [
        { name: "mine", managed: false },
        { name: "tdd-loop", managed: true },
      ],
      content: "# tdd-loop",
    });
  });
});

describe("symlinks under the skills directory", () => {
  let dir: string;
  let outside: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-sync-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "skills-outside-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  async function fillOutsideWithManagedSkill(): Promise<void> {
    await fs.writeFile(path.join(outside, ".lore-managed"), "");
    await fs.writeFile(path.join(outside, "SKILL.md"), "# mine");
  }

  it("reports a tdd-loop symlink to an outside directory as unmanaged", async () => {
    await fillOutsideWithManagedSkill();
    await fs.symlink(outside, path.join(dir, "tdd-loop"));

    expect(await readLocalSkillDirs(dir)).toEqual([
      { name: "tdd-loop", managed: false },
    ]);
  });

  it("reports a tdd-loop directory whose SKILL.md is a symlink as unmanaged", async () => {
    await fillOutsideWithManagedSkill();
    await fs.mkdir(path.join(dir, "tdd-loop"));
    await fs.writeFile(path.join(dir, "tdd-loop", ".lore-managed"), "");
    await fs.symlink(
      path.join(outside, "SKILL.md"),
      path.join(dir, "tdd-loop", "SKILL.md"),
    );

    expect(await readLocalSkillDirs(dir)).toEqual([
      { name: "tdd-loop", managed: false },
    ]);
  });

  it("reports a tdd-loop directory whose marker is a symlink as unmanaged", async () => {
    await fillOutsideWithManagedSkill();
    await fs.mkdir(path.join(dir, "tdd-loop"));
    await fs.symlink(
      path.join(outside, ".lore-managed"),
      path.join(dir, "tdd-loop", ".lore-managed"),
    );

    expect(await readLocalSkillDirs(dir)).toEqual([
      { name: "tdd-loop", managed: false },
    ]);
  });

  it("leaves the outside directory untouched when tdd-loop is a symlink to it", async () => {
    await fillOutsideWithManagedSkill();
    await fs.symlink(outside, path.join(dir, "tdd-loop"));

    await applySkillSync(
      dir,
      planSkillSync([skill("tdd-loop")], await readLocalSkillDirs(dir)),
    );

    expect({
      outsideContent: await fs.readFile(path.join(outside, "SKILL.md"), "utf8"),
      link: await fs.readlink(path.join(dir, "tdd-loop")),
    }).toEqual({ outsideContent: "# mine", link: outside });
  });

  it("keeps a managed-looking symlink old-skill when the skill is deleted upstream", async () => {
    await fillOutsideWithManagedSkill();
    await fs.symlink(outside, path.join(dir, "old-skill"));

    await applySkillSync(dir, planSkillSync([], await readLocalSkillDirs(dir)));

    expect({
      link: await fs.readlink(path.join(dir, "old-skill")),
      outsideEntries: (await fs.readdir(outside)).sort(),
    }).toEqual({
      link: outside,
      outsideEntries: [".lore-managed", "SKILL.md"],
    });
  });

  it("overwrites a managed tdd-loop's SKILL.md with the new content", async () => {
    await fs.mkdir(path.join(dir, "tdd-loop"));
    await fs.writeFile(path.join(dir, "tdd-loop", ".lore-managed"), "");
    await fs.writeFile(path.join(dir, "tdd-loop", "SKILL.md"), "# stale");

    await applySkillSync(
      dir,
      planSkillSync([skill("tdd-loop")], await readLocalSkillDirs(dir)),
    );

    expect(
      await fs.readFile(path.join(dir, "tdd-loop", "SKILL.md"), "utf8"),
    ).toEqual("# tdd-loop");
  });
});
