"use server";

import { revalidatePath } from "next/cache";
import { recordCreditEntry } from "@/lib/api/activity";

// Mutation lives here, not in view; transport failures → user-facing copy
export interface RecordTopUpState {
  error?: string;
  recorded?: string;
}

/** Opening balance wins; sign decides otherwise. Extracted for readability. */
function kindFor(
  formKind: FormDataEntryValue | null,
  amount: number,
): "opening" | "topup" | "correction" {
  if (formKind === "opening") {
    return "opening";
  }

  return amount < 0 ? "correction" : "topup";
}

/** Reject non-numeric amounts here: Number("") is 0, Number("abc") is NaN; both fail API schema with wrong error. */
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
  const effectiveTime = (formData.get("effective_time") as string)?.trim();
  const result = await recordCreditEntry({
    amount_usd: amount,
    // Omit, don't send empty: API defaults missing date/time; empty string fails validation
    ...(effectiveDate ? { effective_date: effectiveDate } : {}),
    ...(effectiveTime ? { effective_time: effectiveTime } : {}),
    // No kind control: sign carries intent; negative entry undoes mistakes, not a "topup"
    kind: kindFor(formData.get("kind"), amount),
    note: ((formData.get("note") as string) ?? "").trim(),
    recorded_by: ((formData.get("recorded_by") as string) ?? "").trim(),
  });

  if (result.status === "ok") {
    // Remaining balance is stale when API returns; refresh to show latest
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
