import { describe, it, expect } from "vitest";

describe("InboxItemState domain model", () => {
  it("exports a Zod schema and column map for inbox item state ([validated by this](specs/inbox/spec.md#L140))", async () => {
    let mod;

    try {
      mod = await import("./inbox-item-state.js");
    } catch (e: any) {
      if (e.message.includes("Cannot find module")) {
        expect.fail(
          "The model libs/shared/src/domain/models/inbox-item-state.ts is missing.",
        );
      }
      throw e;
    }

    const { InboxItemStateSchema, INBOX_ITEM_STATE_COLUMNS } = mod;

    const testData = {
      person: "test-user",
      item_id: "plan:123",
      handled_at: new Date("2024-01-01T00:00:00Z"),
      snoozed_until: null,
      updated_at: new Date("2024-01-01T00:00:00Z"),
    };

    const parsed = InboxItemStateSchema.parse(testData);

    expect({
      hasSchema: InboxItemStateSchema !== undefined,
      hasColumns: INBOX_ITEM_STATE_COLUMNS !== undefined,
      person: parsed.person,
      itemId: parsed.item_id,
    }).toEqual({
      hasSchema: true,
      hasColumns: true,
      person: "test-user",
      itemId: "plan:123",
    });
  });
});
