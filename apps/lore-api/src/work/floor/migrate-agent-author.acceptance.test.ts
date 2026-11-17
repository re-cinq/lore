import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, expect, it } from "vitest";
import { readFloorMigrations, floorApiFor } from "./floor-migrations.js";
import { InMemoryAgentDefinitions } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.fixture.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";

describe("T002: Migrate existing prompts to use Helm author values", () => {
  it("migrates existing agents with hardcoded author blocks cleanly without prompt duplication", async () => {
    const floor = new InMemoryAgentDefinitions();
    const hardcodedBlock = "- Configure your git identity before committing: `git config --global user.name 'Lore Agent'` and `git config --global user.email 'lore-agent@re-cinq.com'`.\n";
    
    await floor.put("loop-dod", {
      settings: {
        model: "claude-opus",
        prompt: `CUSTOM PROMPT START\n${hardcodedBlock}CUSTOM PROMPT END`,
      },
      variants: {}
    });

    const migrations = await readFloorMigrations();
    const migration = migrations.find((m) => m.version.includes("author"));
    
    enforceTrue(migration, Error, "Migration for agent author not found in readFloorMigrations()");

    await migration.migrate(floorApiFor(new FloorAgentDefs(floor)));

    const updatedAgent = await floor.get("loop-dod");
    const updatedPrompt = updatedAgent?.body.settings.prompt;
    
    expect(updatedPrompt).not.toContain("git config");
    expect(updatedPrompt).toContain("CUSTOM PROMPT START");
    expect(updatedPrompt).toContain("CUSTOM PROMPT END");
  });
});