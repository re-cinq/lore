"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface SearchFormProps {
  /** List route the search navigates to (`/context` or `/repos/o/r/context`). */
  basePath: string;
  /** Active content_type filter, preserved across searches. */
  activeType?: string;
  /** Active keyword query, seeds the input. */
  q?: string;
}

/**
 * Keyword search box for the context list. Submitting navigates client-side via
 * the router inside a transition so the button can show a pending state while
 * the new results load. Preserves the active type filter in the URL.
 */
export default function SearchForm({
  basePath,
  activeType,
  q,
}: SearchFormProps) {
  const router = useRouter();
  const [value, setValue] = useState(q ?? "");
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (value) params.set("q", value);
    if (activeType) params.set("type", activeType);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath));
  };

  return (
    <form className="search-form" onSubmit={submit}>
      <input
        type="text"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search context…"
        aria-label="Search context"
      />
      <button type="submit" disabled={isPending}>
        {isPending ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
