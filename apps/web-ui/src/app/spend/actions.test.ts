// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordCreditEntry = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/api/activity", () => ({
  recordCreditEntry: (...a: unknown[]) => recordCreditEntry(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

import { recordTopUpAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }

  return data;
};

beforeEach(() => {
  recordCreditEntry.mockReset();
  revalidatePath.mockReset();
  recordCreditEntry.mockResolvedValue({ status: "ok", data: { id: 1 } });
});

describe("recordTopUpAction", () => {
  it("records the amount and revalidates the page", async () => {
    const state = await recordTopUpAction(null, form({ amount_usd: "100" }));

    expect(recordCreditEntry).toHaveBeenCalledWith({
      amount_usd: 100,
      kind: "topup",
      note: "",
      recorded_by: "",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/spend");
    expect(state).toMatchObject({ recorded: "Recorded 100." });
  });

  it("omits effective_date entirely when the field is blank", async () => {
    // Not sent as "" — the API defaults a MISSING date to `current_date` in
    // Postgres, and an empty string would be a value that fails its format
    // check instead of an absence that takes the default.
    await recordTopUpAction(
      null,
      form({ amount_usd: "100", effective_date: "" }),
    );

    expect(recordCreditEntry).toHaveBeenCalledWith(
      expect.not.objectContaining({ effective_date: expect.anything() }),
    );
  });

  it("passes an explicit date through for a late-recorded top-up", async () => {
    await recordTopUpAction(
      null,
      form({ amount_usd: "250", effective_date: "2026-08-14" }),
    );

    expect(recordCreditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        effective_date: "2026-08-14",
        amount_usd: 250,
      }),
    );
  });

  it("records an opening balance when the ledger is empty", async () => {
    await recordTopUpAction(
      null,
      form({ amount_usd: "412.68", kind: "opening" }),
    );

    expect(recordCreditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "opening", amount_usd: 412.68 }),
    );
  });

  it("rejects an empty amount without calling the API", async () => {
    // The trap this pins: `Number("")` is 0, not NaN, so a blank field would
    // otherwise sail past a plain isFinite check and post a zero entry.
    const state = await recordTopUpAction(null, form({ amount_usd: "" }));

    expect(state).toMatchObject({ error: expect.stringContaining("amount") });
    expect(recordCreditEntry).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric amount without calling the API", async () => {
    const state = await recordTopUpAction(null, form({ amount_usd: "a lot" }));

    expect(state).toMatchObject({ error: expect.stringContaining("amount") });
    expect(recordCreditEntry).not.toHaveBeenCalled();
  });

  it("rejects zero without calling the API", async () => {
    const state = await recordTopUpAction(null, form({ amount_usd: "0" }));

    expect(state).toMatchObject({ error: expect.stringContaining("$0") });
    expect(recordCreditEntry).not.toHaveBeenCalled();
  });

  it("accepts a negative amount as a correction", async () => {
    await recordTopUpAction(null, form({ amount_usd: "-20", note: "typo" }));

    expect(recordCreditEntry).toHaveBeenCalledWith(
      expect.objectContaining({ amount_usd: -20, note: "typo" }),
    );
  });

  it("reports the transport failure and does not revalidate", async () => {
    recordCreditEntry.mockResolvedValue({
      status: "error",
      message: "credit ledger unavailable",
    });

    const state = await recordTopUpAction(null, form({ amount_usd: "100" }));

    expect(state).toMatchObject({ error: "credit ledger unavailable" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("names the missing configuration when the API is not wired up", async () => {
    recordCreditEntry.mockResolvedValue({ status: "unconfigured" });

    const state = await recordTopUpAction(null, form({ amount_usd: "100" }));

    expect(state).toMatchObject({
      error: expect.stringContaining("LORE_API_URL"),
    });
  });
});
