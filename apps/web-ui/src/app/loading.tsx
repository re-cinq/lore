import Skeleton from "@/components/Skeleton";

export default function HomeLoading() {
  return (
    <div role="status" aria-label="Loading repositories">
      <h1>Repositories</h1>
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
