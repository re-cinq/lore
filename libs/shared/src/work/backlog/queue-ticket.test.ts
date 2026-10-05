import { describe, expect, it } from "vitest";
import { queueTicket, type QueueTicketDeps } from "./queue-ticket.js";

function scene(settings: unknown = { implementation_loop: { enabled: true } }) {
  const steps: string[] = [];
  const deps: QueueTicketDeps = {
    rawSettings: () => Promise.resolve(settings),
    addLabel: (issueNumber, label) => {
      steps.push(`label #${issueNumber} ${label}`);

      return Promise.resolve();
    },
    comment: (issueNumber, body) => {
      steps.push(`comment #${issueNumber}: ${body}`);

      return Promise.resolve();
    },
  };

  return { deps, steps };
}

describe("queueTicket", () => {
  it("labels issue 7 priority:medium and says the loop picks it up, when it carries no priority", async () => {
    const { deps, steps } = scene();

    await queueTicket(deps, {
      repo: "acme/widgets",
      issue: { number: 7, labels: ["lore:implementation"] },
    });

    expect(steps).toEqual([
      "label #7 priority:medium",
      "comment #7: Queued for Lore's implementation loop at `priority:medium`. The loop works one ticket of this repository at a time and picks this one up in priority order.",
    ]);
  });

  it("leaves the priority:high of issue 7 as it is", async () => {
    const { deps, steps } = scene();

    await queueTicket(deps, {
      repo: "acme/widgets",
      issue: { number: 7, labels: ["lore", "priority:high"] },
    });

    expect(steps).toEqual([
      "comment #7: Queued for Lore's implementation loop at `priority:high`. The loop works one ticket of this repository at a time and picks this one up in priority order.",
    ]);
  });

  it("queues issue 7 and says nothing will pick it up while the loop is off for acme/widgets", async () => {
    const { deps, steps } = scene({});

    await queueTicket(deps, {
      repo: "acme/widgets",
      issue: { number: 7, labels: ["lore"] },
    });

    expect(steps).toEqual([
      "label #7 priority:medium",
      "comment #7: Queued for Lore's implementation loop at `priority:medium`, but the loop is switched off for acme/widgets, so nothing picks this ticket up until it is switched on in the repository's settings.",
    ]);
  });
});
