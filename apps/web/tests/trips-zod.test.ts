import { describe, expect, it } from "vitest";
import { GetPlanResponse } from "@/shared/api/generated/planning.zod";
import { GetTripResponse, ListTripsResponse } from "@/shared/api/generated/trips.zod";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const TRIP_ID = "660e8400-e29b-41d4-a716-446655440000";
const PLAN_ID = "770e8400-e29b-41d4-a716-446655440000";

function trip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP_ID,
    name: "京都 2 泊",
    startsOn: "2026-09-01",
    endsOn: "2026-09-03",
    status: "planning",
    version: "1",
    createdAt: "2026-08-01T10:00:00Z",
    startedAt: null,
    finishedAt: null,
    createdBy: USER_ID,
    startedBy: null,
    finishedBy: null,
    ...overrides,
  };
}

describe("生成した web 用 Zod の応答スキーマ", () => {
  it("絵文字を含む有効な名前（UTF-16 で 100 超）の応答を弾かない", () => {
    // API はコードポイントで数えるため、絵文字 51 個（51 コードポイント / UTF-16 で 102）の
    // 名前は有効。callApi の応答検証が UTF-16 の .max() だとこれを誤って弾く（レビュー指摘）
    const name = "🍣".repeat(51);
    expect(name.length).toBe(102);

    const result = GetTripResponse.safeParse(trip({ name }));
    expect(result.success).toBe(true);
  });

  it("予定の名前・メモもコードポイントの上限を誤って弾かない", () => {
    const result = GetPlanResponse.safeParse({
      id: PLAN_ID,
      tripId: TRIP_ID,
      name: "🍜".repeat(51),
      kind: "food",
      date: "2026-09-02",
      time: null,
      memo: "🍺".repeat(1500),
      cancelledAt: null,
      cancelledBy: null,
      version: "2",
      achievement: null,
      booking: null,
      canChangeKind: true,
      kindChangeReason: null,
    });
    expect(result.success).toBe(true);
  });

  it("型が違う応答は弾く（構造の検証は残る）", () => {
    const result = GetTripResponse.safeParse(trip({ startsOn: "not-a-date" }));
    expect(result.success).toBe(false);
  });

  it("listTrips の応答も同じく絵文字の名前を通す", () => {
    const result = ListTripsResponse.safeParse({
      items: [trip({ name: "🍣".repeat(51) })],
      nextCursor: null,
    });
    expect(result.success).toBe(true);
  });
});
