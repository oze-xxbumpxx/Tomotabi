import {
  Bed,
  ForkKnife,
  MapPin,
  ShoppingBag,
  Train,
} from "@phosphor-icons/react";
import type { PlanKind } from "@tomotabi/contracts";
import { PLAN_KIND_LABEL, PLAN_KINDS } from "../model/plan-kind";

const KIND_ICON: Record<PlanKind, typeof MapPin> = {
  place: MapPin,
  food: ForkKnife,
  shopping: ShoppingBag,
  lodging: Bed,
  transport: Train,
};

export { PLAN_KIND_LABEL, PLAN_KINDS };

/** 種類のアイコン（designの対応：map-pin / fork-knife / shopping-bag / bed / train）。 */
export function PlanKindIcon({
  kind,
  size = 14,
}: {
  kind: PlanKind;
  size?: number;
}) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} aria-hidden="true" />;
}
