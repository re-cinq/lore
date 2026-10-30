import { describe, it, expect } from "vitest";
import type {
  AgentDefinitionBody,
  DefinitionApi,
  DefinitionRowView,
  PutResult,
} from "@re-cinq/floor-client";
import { FloorAgentDefs } from "./agent-defs-floor.js";

class InMemoryAgentDefinitions implements DefinitionApi<AgentDefinitionBody> {
  readonly rows = new Map<string, DefinitionRowView<AgentDefinitionBody>[]>();

  list(): Promise<DefinitionRowView<AgentDefinitionBody>[]> {
    return Promise.resolve(
      [...this.rows.values()].map((versions) => versions[versions.length - 1]),
    );
  }

  get(id: string): Promise<DefinitionRowView<AgentDefinitionBody> | null> {
    const versions = this.rows.get(id) ?? [];

    return Promise.resolve(versions[versions.length - 1] ?? null);
  }

  versions(id: string): Promise<DefinitionRowView<AgentDefinitionBody>[]> {
    return Promise.resolve(this.rows.get(id) ?? []);
  }

  version(): Promise<DefinitionRowView<AgentDefinitionBody> | null> {
    return Promise.resolve(null);
  }

  put(id: string, body: AgentDefinitionBody): Promise<PutResult> {
    const versions = this.rows.get(id) ?? [];
    const hash = `v${versions.length + 1}`;

    this.rows.set(id, [...versions, this.stored(id, hash, body)]);

    return Promise.resolve({ hash, created: true });
  }

  archive(id: string): Promise<void> {
    this.rows.delete(id);

    return Promise.resolve();
  }

  protected stored(
    id: string,
    hash: string,
    body: AgentDefinitionBody,
  ): DefinitionRowView<AgentDefinitionBody> {
    return {
      kind: "agent_definition",
      id,
      hash,
      body: structuredClone(body),
      archivedAt: null,
      createdBy: null,
      createdAt: "2026-10-31T00:00:00Z",
    };
  }
}

class ModelDroppingAgentDefinitions extends InMemoryAgentDefinitions {
  protected override stored(
    id: string,
    hash: string,
    body: AgentDefinitionBody,
  ): DefinitionRowView<AgentDefinitionBody> {
    const { model: _dropped, ...settings } = body.settings;

    return super.stored(id, hash, { ...body, settings });
  }
}

const LOOP_TDD: AgentDefinitionBody = {
  settings: {
    model: "claude-opus-4-7",
    prompt: "Make the test pass.",
    image: "ghcr.io/re-cinq/agent:1",
    timeoutMinutes: 60,
    config: { skills: ["lore-context"], test_policy: "scoped" },
  },
};

async function floorWith(
  bodies: Record<string, AgentDefinitionBody>,
  floor = new InMemoryAgentDefinitions(),
) {
  await Promise.all(
    Object.entries(bodies).map(([id, body]) => floor.put(id, body)),
  );

  return { floor, defs: new FloorAgentDefs(floor) };
}

const ottoVariant: AgentDefinitionBody = {
  ...LOOP_TDD,
  variants: {
    "github.com/re-cinq/otto": {
      model: "gemini-3.1-pro",
      config: { test_policy: "none" },
    },
  },
};

describe("FloorAgentDefs", () => {
  it("resolves loop-tdd for re-cinq/lore from the floor settings with no project", async () => {
    const { defs } = await floorWith({ "loop-tdd": LOOP_TDD });

    expect(await defs.resolve("re-cinq/lore", "loop-tdd")).toEqual({
      name: "loop-tdd",
      model: "claude-opus-4-7",
      timeout_minutes: 60,
      prompt: "Make the test pass.",
      image: "ghcr.io/re-cinq/agent:1",
      execution_mode: "claude-code",
      review_required: false,
      project_id: null,
      config: { skills: ["lore-context"], test_policy: "scoped" },
    });
  });

  it("resolves loop-tdd for Re-Cinq/Otto with the github.com/re-cinq/otto variant's model gemini-3.1-pro and test_policy none", async () => {
    const { defs } = await floorWith({ "loop-tdd": ottoVariant });

    expect(await defs.resolve("Re-Cinq/Otto", "loop-tdd")).toMatchObject({
      model: "gemini-3.1-pro",
      prompt: "Make the test pass.",
      project_id: "github.com/re-cinq/otto",
      config: { skills: ["lore-context"], test_policy: "none" },
    });
  });

  it("resolves null for a name the floor does not hold", async () => {
    const { defs } = await floorWith({ "loop-tdd": LOOP_TDD });

    expect(await defs.resolve("re-cinq/lore", "missing")).toBeNull();
  });

  it("lists loop-tdd and code-review for re-cinq/otto sorted by name, loop-tdd on the variant's model", async () => {
    const { defs } = await floorWith({
      "loop-tdd": ottoVariant,
      "code-review": LOOP_TDD,
    });
    const listed = await defs.list("re-cinq/otto");

    expect(listed.map((def) => [def.name, def.model])).toEqual([
      ["code-review", "claude-opus-4-7"],
      ["loop-tdd", "gemini-3.1-pro"],
    ]);
  });

  it("updates loop-tdd for re-cinq/otto by putting a github.com/re-cinq/otto variant holding timeout 90, leaving the settings as they were", async () => {
    const { floor, defs } = await floorWith({ "loop-tdd": LOOP_TDD });

    await defs.update("re-cinq/otto", "loop-tdd", { timeout_minutes: 90 });

    expect((await floor.get("loop-tdd"))?.body).toEqual({
      ...LOOP_TDD,
      variants: { "github.com/re-cinq/otto": { timeoutMinutes: 90 } },
    });
  });

  it("patches the existing github.com/re-cinq/otto variant under its own key when Re-Cinq/Otto sets the image", async () => {
    const { floor, defs } = await floorWith({ "loop-tdd": ottoVariant });

    const updated = await defs.update("Re-Cinq/Otto", "loop-tdd", {
      image: "ghcr.io/re-cinq/agent:2",
    });

    expect({
      variants: (await floor.get("loop-tdd"))?.body.variants,
      image: updated.image,
    }).toEqual({
      variants: {
        "github.com/re-cinq/otto": {
          model: "gemini-3.1-pro",
          image: "ghcr.io/re-cinq/agent:2",
          config: { test_policy: "none" },
        },
      },
      image: "ghcr.io/re-cinq/agent:2",
    });
  });

  it("clears the otto variant's model when patched to null, removing the then empty variant", async () => {
    const { floor, defs } = await floorWith({
      "loop-tdd": {
        ...LOOP_TDD,
        variants: { "re-cinq/otto": { model: "gemini-3.1-pro" } },
      },
    });

    const updated = await defs.update("re-cinq/otto", "loop-tdd", {
      model: null,
    });

    expect({
      body: (await floor.get("loop-tdd"))?.body,
      model: updated.model,
      project: updated.project_id,
    }).toEqual({ body: LOOP_TDD, model: "claude-opus-4-7", project: null });
  });

  it("sets pod_resources limits memory 4Gi inside the otto variant's config", async () => {
    const { floor, defs } = await floorWith({ "loop-tdd": ottoVariant });
    const podResources = { limits: { memory: "4Gi" } };

    await defs.update(
      "re-cinq/otto",
      "loop-tdd",
      {},
      {
        podResources,
        inheritedConfig: null,
      },
    );

    expect(
      (await floor.get("loop-tdd"))?.body.variants?.["github.com/re-cinq/otto"]
        .config,
    ).toEqual({ test_policy: "none", pod_resources: podResources });
  });

  it("creates a github.com/re-cinq/lore variant of loop-tdd with model claude-sonnet-4-6", async () => {
    const { defs } = await floorWith({ "loop-tdd": LOOP_TDD });

    const created = await defs.create("re-cinq/lore", {
      name: "loop-tdd",
      model: "claude-sonnet-4-6",
      timeout_minutes: null,
      prompt: null,
      image: null,
      execution_mode: "claude-code",
      review_required: false,
      config: null,
    });

    expect(created).toMatchObject({
      model: "claude-sonnet-4-6",
      prompt: "Make the test pass.",
      project_id: "github.com/re-cinq/lore",
    });
  });

  it("deletes the re-cinq/otto variant of loop-tdd, leaving the settings", async () => {
    const { floor, defs } = await floorWith({ "loop-tdd": ottoVariant });

    await defs.delete("RE-CINQ/otto", "loop-tdd");

    expect((await floor.get("loop-tdd"))?.body).toEqual(LOOP_TDD);
  });

  it("writes the org model claude-sonnet-4-6 into the settings and keeps the otto variant", async () => {
    const { floor, defs } = await floorWith({ "loop-tdd": ottoVariant });

    await defs.updateOrg("loop-tdd", { model: "claude-sonnet-4-6" });

    expect((await floor.get("loop-tdd"))?.body).toEqual({
      ...ottoVariant,
      settings: { ...LOOP_TDD.settings, model: "claude-sonnet-4-6" },
    });
  });

  it("refuses an org write that clears the prompt loop-tdd cannot run without", async () => {
    const { defs } = await floorWith({ "loop-tdd": LOOP_TDD });

    await expect(defs.updateOrg("loop-tdd", { prompt: null })).rejects.toThrow(
      new Error("agent definition loop-tdd cannot clear prompt on the floor"),
    );
  });

  it("throws when the floor reads loop-tdd back without the model it was given", async () => {
    const { defs } = await floorWith(
      { "loop-tdd": LOOP_TDD },
      new ModelDroppingAgentDefinitions(),
    );

    await expect(
      defs.updateOrg("loop-tdd", { model: "claude-sonnet-4-6" }),
    ).rejects.toThrow(
      new Error(
        "the floor read agent definition loop-tdd back as something other than what was put",
      ),
    );
  });
});
