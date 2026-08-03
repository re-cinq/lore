import Skeleton from "@/components/Skeleton";

// Root-level fallback: also covers every route without a closer loading.tsx
// (/episodes, /graph, /analytics, ...), so it stays generic — a heading bar
// and a card grid, no page-specific text.
export default function RootLoading() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton width={220} height={26} />
      <div className="repo-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="repo-card" key={i}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="45%" style={{ marginTop: 12 }} />
            <Skeleton width="55%" style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
