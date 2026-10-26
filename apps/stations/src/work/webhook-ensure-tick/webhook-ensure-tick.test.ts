import { describe, expect, it } from "vitest";
import {
  NO_WEBHOOK_HOST,
  webhookEnsureTick,
  type EnsureAnswer,
} from "./webhook-ensure-tick.js";

const configured = (): EnsureAnswer => ({
  status: 200,
  body: JSON.stringify({
    state: "configured",
    canonicalUrl: "https://lore-events.example/api/events",
    hookId: 42,
    events: ["check_suite", "push"],
  }),
});

function scene(answers: Record<string, EnsureAnswer | Error>) {
  const asked: string[] = [];
  const logged: string[] = [];
  const deps = {
    repos: () => Promise.resolve(Object.keys(answers)),
    ensure: (repo: string) => {
      asked.push(repo);
      const answer = answers[repo];

      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    log: (line: string) => logged.push(line),
  };

  return { deps, asked, logged };
}

describe("webhookEnsureTick", () => {
  it("ensures re-cinq/lore then re-cinq/hal in order and reports both configured, each with its hook id", async () => {
    const { deps, asked, logged } = scene({
      "re-cinq/lore": configured(),
      "re-cinq/hal": configured(),
    });

    expect(await webhookEnsureTick(deps)).toBe(
      "webhook ensure: 2 configured (re-cinq/lore, re-cinq/hal), 0 failed",
    );
    expect({ asked, logged }).toEqual({
      asked: ["re-cinq/lore", "re-cinq/hal"],
      logged: [
        "re-cinq/lore: configured, hook 42",
        "re-cinq/hal: configured, hook 42",
      ],
    });
  });

  it("logs re-cinq/otto's 403 (the App lacks the permission), re-cinq/hal's 200 that still reads narrow_events and re-cinq/ui's dropped socket as failed, and still ensures re-cinq/lore after them", async () => {
    const { deps, asked, logged } = scene({
      "re-cinq/otto": {
        status: 403,
        body: '{"error":"GitHub App lacks the Webhooks (read & write) permission"}',
      },
      "re-cinq/hal": {
        status: 200,
        body: '{"state":"narrow_events","canonicalUrl":"u","hookId":7,"events":["issues"]}',
      },
      "re-cinq/ui": new Error("socket hang up"),
      "re-cinq/lore": configured(),
    });

    expect(await webhookEnsureTick(deps)).toBe(
      "webhook ensure: 1 configured (re-cinq/lore), 3 failed (re-cinq/otto, re-cinq/hal, re-cinq/ui)",
    );
    expect({ asked, logged: logged.slice(0, 3) }).toEqual({
      asked: ["re-cinq/otto", "re-cinq/hal", "re-cinq/ui", "re-cinq/lore"],
      logged: [
        're-cinq/otto: HTTP 403 {"error":"GitHub App lacks the Webhooks (read & write) permission"}',
        "re-cinq/hal: narrow_events after ensuring, hook 7",
        "re-cinq/ui: socket hang up",
      ],
    });
  });

  it("stops at the first 503 and asks for no other repo, since this deployment names no webhook host or secret", async () => {
    const { deps, asked } = scene({
      "re-cinq/lore": {
        status: 503,
        body: '{"error":"LORE_WEBHOOK_URL not configured"}',
      },
      "re-cinq/hal": configured(),
    });

    expect(await webhookEnsureTick(deps)).toBe(NO_WEBHOOK_HOST);
    expect(asked).toEqual(["re-cinq/lore"]);
  });
});
