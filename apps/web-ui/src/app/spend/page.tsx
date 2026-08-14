export const dynamic = "force-dynamic";
import { getSpend } from "@/lib/api/activity";
import SpendView, {
  type OrgMtdRow,
  type OrgByModelRow,
  type OrgDailyRow,
  type LoreMtdRow,
  type LoreByModelRow,
  type LoreByKindRow,
  type LoreDailyRow,
  type LoreByRepoRow,
  type LoreByTaskTypeRow,
} from "./SpendView";

export default async function SpendPage() {
  // One call: ten month-to-date aggregates that only ever render together.
  const result = await getSpend();
  const empty = {
    org_available: false,
    org_mtd: { billed_usd: 0, input_tokens: 0, output_tokens: 0, as_of: null },
    org_by_model: [],
    org_daily: [],
    lore_today_usd: 0,
    lore_mtd: {
      computed_usd: 0,
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
    },
    lore_by_model: [],
    lore_by_kind: [],
    lore_daily: [],
    lore_by_repo: [],
    lore_by_task_type: [],
  };
  const spend = (result.status === "ok" ? result.data : empty) as unknown as {
    org_available: boolean;
    org_mtd: OrgMtdRow;
    org_by_model: OrgByModelRow[];
    org_daily: OrgDailyRow[];
    lore_today_usd: number;
    lore_mtd: LoreMtdRow;
    lore_by_model: LoreByModelRow[];
    lore_by_kind: LoreByKindRow[];
    lore_daily: LoreDailyRow[];
    lore_by_repo: LoreByRepoRow[];
    lore_by_task_type: LoreByTaskTypeRow[];
  };

  return (
    <SpendView
      orgMtd={spend.org_mtd}
      orgAvailable={spend.org_available}
      loreTodayUsd={spend.lore_today_usd}
      orgByModel={spend.org_by_model}
      orgDaily={spend.org_daily}
      loreMtd={spend.lore_mtd}
      loreByModel={spend.lore_by_model}
      loreByKind={spend.lore_by_kind}
      loreDaily={spend.lore_daily}
      loreByRepo={spend.lore_by_repo}
      loreByTaskType={spend.lore_by_task_type}
    />
  );
}
