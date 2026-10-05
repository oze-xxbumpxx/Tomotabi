import { describe, expect, it } from "vitest";
import type { Context } from "@tomotabi/contracts";
import type { Clock } from "../../../src/adapter/clock/clock";
import { LocalDate } from "../../../src/common/domain/local-date";
import type { LocalTime } from "../../../src/common/domain/local-time";
import type { ActivePlanEvent } from "../../../src/modules/planning/adapter/outbound/record-history.port";
import type { PlanView } from "../../../src/modules/planning/adapter/outbound/planning-read.port";
import type { Plan } from "../../../src/modules/planning/domain/plan";
import type { Trip } from "../../../src/modules/planning/domain/trip";
import { TripPeriod } from "../../../src/modules/planning/domain/trip-period";
import { GetHomeUseCase } from "../../../src/modules/planning/usecase/get-home.usecase";
import {
  InMemoryHomeReadContext,
  inMemoryHomeReadUnitOfWork,
  RecordingHomeLog,
  TRIP_ID,
} from "../../support/home-context";
import type { UserId } from "../../../src/common/domain/user-id";
import {
  ACTOR,
  testPlan,
  testTrip,
} from "../../support/planning-context";

const NOW = new Date("2026-09-05T12:00:00.000Z");

function clockOn(today: string): Clock {
  return {
    now: () => NOW,
    today: () => LocalDate.parse(today),
  };
}

function setup(today: string) {
  const ctx = new InMemoryHomeReadContext();
  const log = new RecordingHomeLog();
  const usecase = new GetHomeUseCase(
    inMemoryHomeReadUnitOfWork(ctx),
    clockOn(today),
    log,
  );
  return { ctx, log, usecase };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return testTrip({ id: TRIP_ID, ...overrides });
}

function planView(
  plan: Partial<Plan> = {},
  extra: Partial<Omit<PlanView, "plan">> = {},
): PlanView {
  return {
    plan: testPlan(plan),
    achievement: null,
    booking: null,
    hasRecordHistory: false,
    ...extra,
  };
}

function achievementOf(planId: string): ActivePlanEvent {
  return {
    id: "66666666-6666-4666-8666-000000000001",
    tripId: TRIP_ID,
    planId,
    kind: "achievement",
    createdBy: ACTOR,
    createdAt: NOW,
  };
}

async function home(usecase: GetHomeUseCase) {
  return usecase.execute({ userId: ACTOR, tripId: TRIP_ID });
}

// RU-05: 表示の種類の判定と境界（旅行とホームの詳細設計 §6）。
describe("ホームの表示の種類", () => {
  it("出発前は before・初日の予定・出発までの日数を返す", async () => {
    const { ctx, usecase } = setup("2026-09-08");
    ctx.seedTrip(trip());

    const result = await home(usecase);

    const context: Context = result.context;
    expect(context.mode).toBe("before");
    expect(context.today).toBe("2026-09-08");
    expect(context.targetDate).toBe("2026-09-10");
    expect(context.daysUntilStart).toBe(2);
    expect(context.dayNumber).toBeNull();
    expect(context.suggestedAction).toBeNull();
    // beforeでは予定の欄は初日の日付で読む。
    expect(result.schedule).toEqual({
      status: "ok",
      data: {
        date: "2026-09-10",
        items: [],
        totalCount: 0,
        achievedCount: 0,
      },
    });
  });

  it("出発の前日は before（境界）", async () => {
    const { ctx, usecase } = setup("2026-09-09");
    ctx.seedTrip(trip());
    const result = await home(usecase);
    expect(result.context.mode).toBe("before");
    expect(result.context.daysUntilStart).toBe(1);
  });

  it.each([
    ["2026-09-10", 1, "初日"],
    ["2026-09-11", 2, "中日"],
    ["2026-09-12", 3, "最終日（境界）"],
  ])(
    "期間中は during・%s は %d 日目（%s）",
    async (today, dayNumber) => {
      const { ctx, usecase } = setup(today);
      ctx.seedTrip(trip({ status: "traveling" }));
      const result = await home(usecase);
      expect(result.context.mode).toBe("during");
      expect(result.context.targetDate).toBe(today);
      expect(result.context.dayNumber).toBe(dayNumber);
      expect(result.context.daysUntilStart).toBeNull();
    },
  );

  it("最終日の翌日は after_dates（境界）", async () => {
    const { ctx, usecase } = setup("2026-09-13");
    ctx.seedTrip(trip({ status: "traveling" }));
    const result = await home(usecase);
    expect(result.context.mode).toBe("after_dates");
    expect(result.context.targetDate).toBeNull();
    expect(result.context.dayNumber).toBeNull();
    // 期間が過ぎた旅行に予定の欄は出さない（欄自体をnull）。
    expect(result.schedule).toEqual({ status: "ok", data: null });
  });

  it("終了した旅行は日付に関わらず completed・予定の欄はnull", async () => {
    const { ctx, usecase } = setup("2026-09-11");
    ctx.seedTrip(
      trip({
        status: "finished",
        finishedAt: NOW,
        finishedBy: ACTOR,
      }),
    );
    const result = await home(usecase);
    expect(result.context.mode).toBe("completed");
    expect(result.context.targetDate).toBeNull();
    expect(result.context.suggestedAction).toBeNull();
    expect(result.schedule).toEqual({ status: "ok", data: null });
  });

  it("同日の旅行（startsOn = endsOn）は当日 during・翌日 after_dates", async () => {
    const sameDay = {
      period: TripPeriod.create(
        LocalDate.parse("2026-09-11"),
        LocalDate.parse("2026-09-11"),
      ),
    };
    {
      const { ctx, usecase } = setup("2026-09-11");
      ctx.seedTrip(trip({ status: "traveling", ...sameDay }));
      const result = await home(usecase);
      expect(result.context.mode).toBe("during");
      expect(result.context.dayNumber).toBe(1);
      expect(result.context.targetDate).toBe("2026-09-11");
    }
    {
      const { ctx, usecase } = setup("2026-09-12");
      ctx.seedTrip(trip({ status: "traveling", ...sameDay }));
      const result = await home(usecase);
      expect(result.context.mode).toBe("after_dates");
      expect(result.context.dayNumber).toBeNull();
    }
  });

  it.each([
    ["planning", "2026-09-11", "during", "start", "計画中のまま当日"],
    ["traveling", "2026-09-09", "before", null, "旅行中だが期間前"],
    ["planning", "2026-09-13", "after_dates", "start", "計画中のまま期間後"],
    ["traveling", "2026-09-13", "after_dates", "finish", "旅行中のまま期間後"],
    ["finished", "2026-09-11", "completed", null, "終了したが期間中"],
  ])(
    "日付と保存状態が食い違う: %s × %s → %s・案内 %s（%s）",
    async (status, today, mode, suggestedAction) => {
      const { ctx, usecase } = setup(today);
      ctx.seedTrip(
        trip({
          status: status as Trip["status"],
          startedAt: status === "planning" ? null : NOW,
          startedBy: status === "planning" ? null : ACTOR,
          finishedAt: status === "finished" ? NOW : null,
          finishedBy: status === "finished" ? ACTOR : null,
        }),
      );
      const result = await home(usecase);
      expect(result.context.mode).toBe(mode);
      expect(result.context.suggestedAction).toBe(suggestedAction);
    },
  );
});

// RU-06: 予定の欄の並び・最大3件・件数・達成（詳細設計 §6「当日予定の抜粋」）。
describe("ホームの予定の欄", () => {
  function duringTrip() {
    return trip({ status: "traveling" });
  }

  it("予定がない日は items=[]・件数0を返す", async () => {
    const { ctx, usecase } = setup("2026-09-11");
    ctx.seedTrip(duringTrip());
    const result = await home(usecase);
    expect(result.schedule).toEqual({
      status: "ok",
      data: {
        date: "2026-09-11",
        items: [],
        totalCount: 0,
        achievedCount: 0,
      },
    });
  });

  it("取りやめていない予定を最大3件、一覧の並びのまま返す", async () => {
    const { ctx, usecase } = setup("2026-09-11");
    ctx.seedTrip(duringTrip());
    ctx.planViews = [
      planView({ id: "00000000-0000-4000-8000-00000000a001", time: "09:00" as LocalTime }),
      planView({ id: "00000000-0000-4000-8000-00000000a002", time: "10:00" as LocalTime }),
      planView({ id: "00000000-0000-4000-8000-00000000a003", time: null }),
      planView({ id: "00000000-0000-4000-8000-00000000a004", time: "13:00" as LocalTime }),
    ];
    const result = await home(usecase);
    const schedule =
      result.schedule.status === "ok" ? result.schedule.data : null;
    expect(schedule?.items.map((item) => item.id)).toEqual([
      "00000000-0000-4000-8000-00000000a001",
      "00000000-0000-4000-8000-00000000a002",
      "00000000-0000-4000-8000-00000000a003",
    ]);
    expect(schedule?.totalCount).toBe(4);
    expect(schedule?.achievedCount).toBe(0);
  });

  it("達成済みは末尾にまわし、未達成を先に返す", async () => {
    const { ctx, usecase } = setup("2026-09-11");
    ctx.seedTrip(duringTrip());
    // 一覧の並び（時刻順）で a1→a2→a3。達成済みのa1は末尾へ。
    ctx.planViews = [
      planView(
        { id: "00000000-0000-4000-8000-00000000a001" },
        { achievement: achievementOf("00000000-0000-4000-8000-00000000a001") },
      ),
      planView({ id: "00000000-0000-4000-8000-00000000a002" }),
      planView({ id: "00000000-0000-4000-8000-00000000a003" }),
    ];
    const result = await home(usecase);
    const schedule =
      result.schedule.status === "ok" ? result.schedule.data : null;
    expect(schedule?.items.map((item) => item.id)).toEqual([
      "00000000-0000-4000-8000-00000000a002",
      "00000000-0000-4000-8000-00000000a003",
      "00000000-0000-4000-8000-00000000a001",
    ]);
    expect(schedule?.achievedCount).toBe(1);
    // 達成済みの予定にもachievementは付く（画面が達成表示に使う）。
    const last = schedule?.items[2];
    expect(last?.achievement?.kind).toBe("achievement");
  });

  it.each([
    [0, 4, 4, 0, "達成0件"],
    [3, 1, 4, 3, "未達成1件＋達成3件"],
    [4, 0, 4, 4, "全部達成"],
  ])(
    "達成 %d 件・未達成 %d 件 → totalCount %d・achievedCount %d（%s）",
    async (achieved, unachieved, total, achievedCount) => {
      const { ctx, usecase } = setup("2026-09-11");
      ctx.seedTrip(duringTrip());
      const views: PlanView[] = [];
      for (let i = 0; i < unachieved + achieved; i += 1) {
        const id = `00000000-0000-4000-8000-00000000b0${String(i).padStart(2, "0")}`;
        views.push(
          planView(
            { id },
            i < achieved ? { achievement: achievementOf(id) } : {},
          ),
        );
      }
      ctx.planViews = views;
      const result = await home(usecase);
      const schedule =
        result.schedule.status === "ok" ? result.schedule.data : null;
      expect(schedule?.items).toHaveLength(3);
      expect(schedule?.totalCount).toBe(total);
      expect(schedule?.achievedCount).toBe(achievedCount);
      // 未達成は達成済みより前。未達成が足りなければ達成済みで3件埋める。
      const unachievedItems = schedule?.items.filter(
        (item) => item.achievement === null,
      );
      expect(unachievedItems).toHaveLength(Math.min(unachieved, 3));
    },
  );

  it("取りやめた予定は件数にもitemsにも含めない", async () => {
    const { ctx, usecase } = setup("2026-09-11");
    ctx.seedTrip(duringTrip());
    ctx.planViews = [
      planView({ id: "00000000-0000-4000-8000-00000000a001" }),
      planView({
        id: "00000000-0000-4000-8000-00000000a002",
        cancelledAt: NOW,
        cancelledBy: ACTOR,
      }),
      planView({ id: "00000000-0000-4000-8000-00000000a003" }),
    ];
    const result = await home(usecase);
    const schedule =
      result.schedule.status === "ok" ? result.schedule.data : null;
    expect(schedule?.items.map((item) => item.id)).toEqual([
      "00000000-0000-4000-8000-00000000a001",
      "00000000-0000-4000-8000-00000000a003",
    ]);
    expect(schedule?.totalCount).toBe(2);
  });
});

describe("ホームの欄の失敗", () => {
  it("欄が回復できる誤りで失敗したらその欄だけ unavailable・warnを残し、ほかの欄は返す", async () => {
    const { ctx, log, usecase } = setup("2026-09-11");
    ctx.seedTrip(trip({ status: "traveling" }));
    ctx.planViews = [planView()];
    ctx.failOn.set("balance", new Error("deadlock"));

    const result = await home(usecase);

    expect(result.schedule.status).toBe("ok");
    expect(result.balance).toEqual({
      status: "unavailable",
      code: "TEMPORARILY_UNAVAILABLE",
    });
    expect(result.recentRecords.status).toBe("ok");
    expect(log.entries).toEqual([
      { section: "balance", errorKind: "Error" },
    ]);
  });

  it("欄の失敗のうち接続が切れた誤りは欄ごとに分けず全体の失敗にする", async () => {
    const { ctx, usecase } = setup("2026-09-11");
    ctx.seedTrip(trip({ status: "traveling" }));
    const broken = Object.assign(new Error("connection dropped"), {
      code: "ECONNRESET",
    });
    ctx.failOn.set("schedule", broken);

    await expect(home(usecase)).rejects.toMatchObject({ code: "ECONNRESET" });
  });

  it("旅行が読めなければ403 TRIP_NOT_ACCESSIBLE（存在しない・参加していないを区別しない）", async () => {
    const { ctx, usecase } = setup("2026-09-11");
    ctx.seedTrip(trip());

    // 参加していない人から見ると旅行は無い（既定の二人組に入らない人）。
    const outsider =
      "00000000-0000-4000-8000-000000000099" as UserId;
    await expect(
      usecase.execute({ userId: outsider, tripId: TRIP_ID }),
    ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
    // 存在しない旅行も同じ403。
    await expect(
      usecase.execute({
        userId: ACTOR,
        tripId: "88888888-8888-4888-8888-888888888888",
      }),
    ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
  });
});
