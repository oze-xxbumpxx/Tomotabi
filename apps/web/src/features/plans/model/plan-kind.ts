import type { PlanKind } from "@tomotabi/contracts";

/** 種類の表示名（designの一覧の順：場所・食べ処・買い物・宿・移動）。 */
export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  place: "場所",
  food: "食べ処",
  shopping: "買い物",
  lodging: "宿",
  transport: "移動",
};

export const PLAN_KINDS: PlanKind[] = [
  "place",
  "food",
  "shopping",
  "lodging",
  "transport",
];
