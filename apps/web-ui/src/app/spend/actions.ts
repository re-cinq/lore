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
function parseAmount(
  formData: FormData,
): { raw: string; amount: number } | null {
  const raw = (formData.get("amount_usd") as string | null)?.trim();

  if (!raw) {
    return null;
  }
  const amount = Number(raw);

  return Number.isFinite(amount) ? { raw, amount } : null;
}

function trimmedFormValue(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function creditEntryFields(formData: FormData, amount: number) {
  const effectiveDate = trimmedFormValue(formData, "effective_date");
  const effectiveTime = trimmedFormValue(formData, "effective_time");

  return {
    amount_usd: amount,
    // Omit, don't send empty: API defaults missing date/time; empty string fails validation
    ...(effectiveDate ? { effective_date: effectiveDate } : {}),
    ...(effectiveTime ? { effective_time: effectiveTime } : {}),
    // No kind control: sign carries intent; negative entry undoes mistakes, not a "topup"
    kind: kindFor(formData.get("kind"), amount),
    note: trimmedFormValue(formData, "note"),
    recorded_by: trimmedFormValue(formData, "recorded_by"),
  };
}

function topUpErrorMessage(
  result: Exclude<
    Awaited<ReturnType<typeof recordCreditEntry>>,
    { status: "ok" }
  >,
): string {
  return result.status === "unconfigured"
    ? "Spend API is not configured (LORE_API_URL / token)."
    : result.message;
}

export async function recordTopUpAction(
  _prev: RecordTopUpState | null,
  formData: FormData,
): Promise<RecordTopUpState> {
  const parsed = parseAmount(formData);

  if (!parsed) {
    return { error: "Enter an amount in dollars, for example 100." };
  }

  if (parsed.amount === 0) {
    return { error: "An entry of $0 would not move the balance." };
  }
  const result = await recordCreditEntry(
    creditEntryFields(formData, parsed.amount),
  );

  if (result.status === "ok") {
    // Remaining balance is stale when API returns; refresh to show latest
    revalidatePath("/spend");

    return { recorded: `Recorded ${parsed.raw}.` };
  }

  return { error: topUpErrorMessage(result) };
}
