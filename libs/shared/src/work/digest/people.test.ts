import { describe, it, expect } from "vitest";
import { enforceTrue } from "../../lib/enforce.js";
import { parseSlackUsers, resolveNames, type NameDeps } from "./people.js";

function deps(overrides: Partial<NameDeps> = {}): NameDeps {
  return {
    override: {},
    emailOf: async (login) => `${login}@re-cinq.com`,
    slackIdByEmail: async (email) =>
      email === "gedaiu@re-cinq.com" ? "U01BOGDAN" : null,
    slackName: async (id) => (id === "U01BOGDAN" ? "Bogdan" : "Loredana"),
    ...overrides,
  };
}

describe("parseSlackUsers", () => {
  it("reads a GitHub login to Slack user id map", () => {
    expect(parseSlackUsers('{"loredanamoanga":"U02LORE"}')).toEqual({
      loredanamoanga: "U02LORE",
    });
  });

  it("returns an empty map for nothing stored", () => {
    expect(parseSlackUsers(undefined)).toEqual({});
  });

  it("throws naming slack_users for a value that is not a Slack user id", () => {
    expect(() => parseSlackUsers('{"gedaiu":"bogdan"}')).toThrow(/slack_users/);
  });
});

describe("resolveNames", () => {
  it("names a person through their commit email and Slack's directory", async () => {
    expect(await resolveNames(["gedaiu"], deps())).toEqual({
      gedaiu: "Bogdan",
    });
  });

  it("prefers the manual override over the email match", async () => {
    expect(
      await resolveNames(["gedaiu"], deps({ override: { gedaiu: "U02LORE" } })),
    ).toEqual({ gedaiu: "Loredana" });
  });

  it("leaves out a person no email or override matches", async () => {
    expect(await resolveNames(["vvondruska"], deps())).toEqual({});
  });

  it("never looks up a bot", async () => {
    const asked: string[] = [];

    await resolveNames(
      ["lore-agent[bot]"],
      deps({
        emailOf: async (login) => {
          asked.push(login);

          return null;
        },
      }),
    );

    expect(asked).toEqual([]);
  });

  it("leaves out a person whose lookup throws, keeping the others", async () => {
    expect(
      await resolveNames(
        ["gedaiu", "muemich"],
        deps({
          emailOf: async (login) => {
            enforceTrue(login !== "muemich", Error, "GitHub 502");

            return `${login}@re-cinq.com`;
          },
        }),
      ),
    ).toEqual({ gedaiu: "Bogdan" });
  });
});
