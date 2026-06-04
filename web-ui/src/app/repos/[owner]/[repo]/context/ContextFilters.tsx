import { orderTypes, labelForType, contextHref } from '@/lib/content-types';

export interface ContextFiltersProps {
  /** List route the form + chips point at (`/context` or `/repos/o/r/context`). */
  basePath: string;
  /** Content types actually present in the data — one chip each. */
  types: string[];
  activeType?: string;
  q?: string;
}

/**
 * Keyword search box + data-driven content-type chips. A GET `<form>` keeps the
 * whole thing server-rendered (no client state): searching navigates to
 * `?q=…`, the hidden `type` field preserves the active filter, and each chip
 * preserves the active query. Pure render.
 */
export default function ContextFilters({ basePath, types, activeType, q }: ContextFiltersProps) {
  const ordered = orderTypes(types);
  return (
    <>
      <form className="search-form" method="get" action={basePath}>
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search context…"
          aria-label="Search context"
        />
        {activeType ? <input type="hidden" name="type" value={activeType} /> : null}
        <button type="submit">Search</button>
      </form>
      <div className="filter-form">
        <a href={contextHref(basePath, undefined, q)} className={!activeType ? 'active' : ''}>
          All
        </a>
        {ordered.map((t) => (
          <a key={t} href={contextHref(basePath, t, q)} className={activeType === t ? 'active' : ''}>
            {labelForType(t)}
          </a>
        ))}
      </div>
    </>
  );
}
