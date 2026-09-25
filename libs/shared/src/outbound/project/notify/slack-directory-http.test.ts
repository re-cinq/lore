import { describe, it, expect, afterEach } from "vitest";
import { SlackDirectoryHttp } from "./slack-directory-http.js";

const originalFetch = globalThis.fetch;

function slackAnswers(answer: unknown) {
  const urls: string[] = [];

  globalThis.fetch = (async (url: string) => {
    urls.push(url);

    return { json: async () => answer };
  }) as unknown as typeof fetch;

  return urls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const directory = () =>
  new SlackDirectoryHttp({ LORE_SLACK_BOT_TOKEN: "xoxb" });

describe("SlackDirectoryHttp", () => {
  it("returns the user id Slack finds for an email", async () => {
    const urls = slackAnswers({ ok: true, user: { id: "U01BOGDAN" } });

    expect({
      id: await directory().idByEmail("bogdan@re-cinq.com"),
      url: urls[0],
    }).toEqual({
      id: "U01BOGDAN",
      url: "https://slack.com/api/users.lookupByEmail?email=bogdan%40re-cinq.com",
    });
  });

  it("returns null when Slack knows nobody by the email", async () => {
    slackAnswers({ ok: false, error: "users_not_found" });

    expect(await directory().idByEmail("nobody@example.com")).toBe(null);
  });

  it("prefers the display name and falls back to the real name", async () => {
    slackAnswers({
      ok: true,
      user: {
        id: "U1",
        profile: { display_name: "", real_name: "Loredana Moanga" },
      },
    });

    expect(await directory().displayName("U1")).toBe("Loredana Moanga");
  });

  it("throws with Slack's error when the scope is missing", async () => {
    slackAnswers({ ok: false, error: "missing_scope" });

    await expect(directory().idByEmail("bogdan@re-cinq.com")).rejects.toThrow(
      new Error("slack users.lookupByEmail: missing_scope"),
    );
  });
});
