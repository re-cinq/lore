import { orderTypes, labelForType, contextHref } from '@/lib/content-types';
import SearchForm from './SearchForm';
import FilterChip from './FilterChip';

export interface ContextFiltersProps {
  /** List route the form + chips point at (`/context` or `/repos/o/r/context`). */
  basePath: string;
  /** Content types actually present in the data — one chip each. */
  types: string[];
  activeType?: string;
  q?: string;
}

/**
 * Keyword search box + data-driven content-type chips. The search box and chips
 * navigate client-side (SearchForm / FilterChip) so each shows a loading state
 * while its results load; the chip set is data-driven and preserves the active
 * query. Pure render.
 */
export default function ContextFilters({ basePath, types, activeType, q }: ContextFiltersProps) {
  const ordered = orderTypes(types);
  return (
    <>
      <SearchForm basePath={basePath} activeType={activeType} q={q} />
      <div className="filter-form">
        <FilterChip href={contextHref(basePath, undefined, q)} active={!activeType}>
          All
        </FilterChip>
        {ordered.map((t) => (
          <FilterChip key={t} href={contextHref(basePath, t, q)} active={activeType === t}>
            {labelForType(t)}
          </FilterChip>
        ))}
      </div>
    </>
  );
}
