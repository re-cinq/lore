import Skeleton from "@/components/Skeleton";

export default function ContextLoading() {
  return (
    <div role="status" aria-label="Loading context">
      <h1>Context</h1>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            width={72}
            height={26}
            key={i}
            style={{ borderRadius: "var(--radius-pill)" }}
          />
        ))}
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div className="spec-card" key={i} style={{ marginTop: 12 }}>
          <Skeleton width="50%" height={16} />
          <Skeleton width="95%" style={{ marginTop: 10 }} />
          <Skeleton width="80%" style={{ marginTop: 6 }} />
        </div>
      ))}
    </div>
  );
}
