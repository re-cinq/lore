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

/** Keyword search box; client-side nav via router transition preserves active type filter. */
export default function SearchForm(props: SearchFormProps) {
  const { basePath, activeType, q } = props;
  const router = useRouter();
  const [value, setValue] = useState(q ?? "");
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(() => router.push(searchHref(basePath, value, activeType)));
  };

  return (
    <form className="search-form" onSubmit={submit}>
      <SearchInput value={value} onChange={setValue} />
      <button type="submit" disabled={isPending}>
        {isPending ? "Searching…" : "Search"}
      </button>
    </form>
  );
}

/** The URL this search asks for. Carries the active type filter along with the query, so searching does not silently widen the list back to every content type. */
function searchHref(
  basePath: string,
  value: string,
  activeType: string | undefined,
): string {
  const params = new URLSearchParams();

  if (value) {
    params.set("q", value);
  }

  if (activeType) {
    params.set("type", activeType);
  }
  const qs = params.toString();

  return qs ? `${basePath}?${qs}` : basePath;
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

function SearchInput({ value, onChange }: SearchInputProps) {
  return (
    <input
      type="text"
      name="q"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search context…"
      aria-label="Search context"
    />
  );
}
