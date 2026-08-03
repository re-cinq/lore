import Skeleton from "@/components/Skeleton";

export default function SearchLoading() {
  return (
    <div role="status" aria-label="Loading search">
      <h1>Search Memories</h1>
      <Skeleton height={38} style={{ marginTop: 16 }} />
      {Array.from({ length: 3 }, (_, i) => (
        <div className="search-result" key={i} style={{ marginTop: 12 }}>
          <Skeleton width="40%" height={16} />
          <Skeleton width="90%" style={{ marginTop: 10 }} />
          <Skeleton width="70%" style={{ marginTop: 6 }} />
        </div>
      ))}
    </div>
  );
}
