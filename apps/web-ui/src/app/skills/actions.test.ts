// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const revalidatePath = vi.fn();
const redirect = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const { createSkill, updateSkill, deleteSkill } = await import("./actions");

let fetchMock: ReturnType<typeof vi.fn>;

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

const skillForm = (content: string, enabled = "yes") => {
  const form = new FormData();

  form.set("name", "ghost");
  form.set("title", "Ghost");
  form.set("content", content);
  form.set("enabled", enabled);

  return form;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSkill", () => {
  it("returns the API's message and what was typed when it answers 400 for content without a lore-help block", async () => {
    const message =
      "content: must carry a lore-help block with a Summary and a Usage line";

    answer(400, { error: message });

    const state = await createSkill({}, skillForm("no help here"));

    expect({ state, redirected: redirect.mock.calls.length }).toEqual({
      state: {
        error: message,
        values: {
          name: "ghost",
          title: "Ghost",
          description: "",
          model: "",
          content: "---\nname: ghost\n---\n\n# Ghost\n\nno help here",
          enabled: true,
        },
      },
      redirected: 0,
    });
  });

  it("redirects to /skills when the API answers 200", async () => {
    answer(200, { ok: true });

    await createSkill({}, skillForm("## Help"));

    expect({
      revalidated: revalidatePath.mock.calls,
      redirected: redirect.mock.calls,
    }).toEqual({
      revalidated: [["/skills"]],
      redirected: [["/skills"]],
    });
  });
});

describe("updateSkill", () => {
  it('returns "no skill named ghost" when the API answers 404', async () => {
    answer(404, { error: "no skill named ghost" });

    const state = await updateSkill("ghost", {}, skillForm("x"));

    expect(state).toMatchObject({ error: "no skill named ghost" });
  });
});

describe("updateSkill request", () => {
  it("sends a PUT body without name for ghost", async () => {
    answer(200, { ok: true });

    await updateSkill("ghost", {}, skillForm("## Help"));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(body).toEqual({
      title: "Ghost",
      model: null,
      content: "---\nname: ghost\n---\n\n# Ghost\n\n## Help",
      enabled: true,
    });
  });

  it("sends content whose frontmatter carries the posted description, model and extra keys for ghost", async () => {
    answer(200, { ok: true });
    const form = skillForm("## Help");

    form.set("description", "Haunts");
    form.set("model", "claude-haiku-4-5-20251001");
    form.set("extra_frontmatter", "context: fork");
    await updateSkill("ghost", {}, form);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      description: "Haunts",
      model: "claude-haiku-4-5-20251001",
      content:
        "---\nname: ghost\ndescription: Haunts\nmodel: claude-haiku-4-5-20251001\ncontext: fork\n---\n\n# Ghost\n\n## Help",
    });
  });
});

describe("updateSkill enabled field", () => {
  it("sends enabled false when the form says no", async () => {
    answer(200, { ok: true });

    await updateSkill("ghost", {}, skillForm("## Help", "no"));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      enabled: false,
    });
  });
});

describe("deleteSkill", () => {
  it("returns the error when the API answers 503", async () => {
    answer(503, { error: "database unavailable" });

    const state = await deleteSkill("ghost");

    expect(state).toEqual({ error: "database unavailable" });
  });

  it("revalidates /skills and does not redirect when the API answers 200", async () => {
    answer(200, { ok: true, deleted: "ghost" });

    const state = await deleteSkill("ghost");

    expect({
      state,
      revalidated: revalidatePath.mock.calls,
      redirected: redirect.mock.calls,
    }).toEqual({ state: {}, revalidated: [["/skills"]], redirected: [] });
  });
});
