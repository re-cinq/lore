import Skeleton from "@/components/Skeleton";

export default function RepoOverviewLoading() {
  return (
    <div role="status" aria-label="Loading repository overview">
      <div className="spec-card">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            width={`${85 - i * 10}%`}
            key={i}
            style={i > 0 ? { marginTop: 12 } : undefined}
          />
        ))}
      </div>
      <div className="spec-card">
        <Skeleton width="30%" height={18} />
        <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton width={72} height={34} key={i} />
          ))}
        </div>
      </div>
      <Skeleton width="25%" height={20} style={{ marginTop: 24 }} />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} style={{ marginTop: 10 }} />
      ))}
      <Skeleton width="25%" height={20} style={{ marginTop: 24 }} />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} style={{ marginTop: 10 }} />
      ))}
    </div>
  );
}
