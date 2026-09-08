import { orderTypes, labelForType, contextHref } from "@/lib/content-types";
import SearchForm from "./SearchForm";
import FilterChip from "./FilterChip";

export interface ContextFiltersProps {
  /** List route the form + chips point at (`/context` or `/repos/o/r/context`). */
  basePath: string;
  /** Content types actually present in the data — one chip each. */
  types: string[];
  activeType?: string;
  q?: string;
}

/** Keyword search + content-type chips; both navigate client-side with loading state. */
export default function ContextFilters(props: ContextFiltersProps) {
  const { basePath, activeType, q } = props;

  return (
    <>
      <SearchForm basePath={basePath} activeType={activeType} q={q} />
      <div className="filter-form">
        <FilterChip
          href={contextHref(basePath, undefined, q)}
          active={!activeType}
        >
          All
        </FilterChip>
        <TypeChips {...props} />
      </div>
    </>
  );
}

/** One chip per content type actually present in the data. */
function TypeChips({ basePath, types, activeType, q }: ContextFiltersProps) {
  return orderTypes(types).map((t) => (
    <FilterChip
      key={t}
      href={contextHref(basePath, t, q)}
      active={activeType === t}
    >
      {labelForType(t)}
    </FilterChip>
  ));
}
