import PlanDetailSkeleton from "./PlanDetailSkeleton";

// The repo's loading.tsx never shows between /plans and /plans/<id> (the segment under [repo] stays "plans"), so the plan page has its own.
export default function PlanLoading() {
  return <PlanDetailSkeleton />;
}
