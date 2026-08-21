"use server";

import { revalidatePath } from "next/cache";
import { recordCreditEntry } from "@/lib/api/activity";

// The mutation lives here, not inside the view. A view renders figures; it
// should not also be where a write is defined and where transport failures are
// turned into user-facing copy.

export interface RecordTopUpState {
  error?: string;
  recorded?: string;
}

/**
 * Amounts arrive as text from a form field, so every non-numeric case has to be
 * rejected here rather than sent onward: `Number("")` is 0 and `Number("abc")`
 * is NaN, and both would otherwise reach the API as a body that fails schema
 * validation with a message about the wrong thing.
 */
export async function recordTopUpAction(
  _prev: RecordTopUpState | null,
  formData: FormData,
): Promise<RecordTopUpState> {
  const raw = (formData.get("amount_usd") as string)?.trim();
  const amount = Number(raw);

  if (!raw || !Number.isFinite(amount)) {
    return { error: "Enter an amount in dollars, for example 100." };
  }

  if (amount === 0) {
    return { error: "An entry of $0 would not move the balance." };
  }
  const effectiveDate = (formData.get("effective_date") as string)?.trim();
  const result = await recordCreditEntry({
    amount_usd: amount,
    // Omitted rather than sent empty: the API defaults a missing date to today
    // in Postgres, which is the right clock for a row Postgres is storing.
    ...(effectiveDate ? { effective_date: effectiveDate } : {}),
    kind: formData.get("kind") === "opening" ? "opening" : "topup",
    note: ((formData.get("note") as string) ?? "").trim(),
    recorded_by: ((formData.get("recorded_by") as string) ?? "").trim(),
  });

  if (result.status === "ok") {
    // The remaining figure is stale the instant this lands, and the whole point
    // of the screen is that it is not.
    revalidatePath("/spend");

    return { recorded: `Recorded ${raw}.` };
  }

  return {
    error:
      result.status === "unconfigured"
        ? "Spend API is not configured (LORE_API_URL / token)."
        : result.message,
  };
}
