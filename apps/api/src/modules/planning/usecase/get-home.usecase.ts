import type {
  Context,
  Home,
  HomeSection,
  Schedule,
} from "@tomotabi/contracts";
import type { Clock } from "../../../adapter/clock/clock";
import { LocalDate } from "../../../common/domain/local-date";
import type { Trip, TripStatus } from "../domain/trip";
import type {
  GetHomeInput,
  GetHomeInputPort,
} from "../adapter/inbound/get-home.input-port";
import type {
  HomeLog,
  HomeReadUnitOfWork,
  HomeSectionName,
  HomeSectionResult,
} from "../adapter/outbound/home-read.port";
import type { PlanView } from "../adapter/outbound/planning-read.port";
import { toPlanDto } from "./plan-dto";
import { toTripDto } from "./trip-dto";
import { tripNotAccessible } from "./trip-write-flow";

/**
 * ホーム（F-40）。1つのトランザクションの同じスナップショットから、
 * 旅行 → 予定の欄 → 精算の欄 → 最近の記録の順に読み、画面が日付から
 * 計算し直さなくてよい表示の文脈と一緒に返す。
 * 欄の読み取りの失敗はその欄だけ`unavailable`にする（F-48）。旅行の
 * 読み取りと、欄の失敗のうち回復できない誤り（接続が切れた・認証の
 * 失敗）はホーム全体の失敗になる。
 */
export class GetHomeUseCase implements GetHomeInputPort {
  constructor(
    private readonly unitOfWork: HomeReadUnitOfWork,
    private readonly clock: Clock,
    private readonly log: HomeLog,
  ) {}

  async execute(input: GetHomeInput): Promise<Home> {
    return this.unitOfWork.run(async (ctx) => {
      // 旅行の読み取りはホーム全体の前提（参加していなければ403）。
      // この失敗は欄の失敗ではなく、トランザクションの外側へ伝わる。
      const tripRow = await ctx.trip.find(input.tripId, input.userId);
      if (tripRow === null) {
        throw tripNotAccessible();
      }
      const { trip, roster } = tripRow;
      const today = this.clock.today();
      const context = contextOf(trip, today);

      const scheduleResult = await ctx.runSection(async () => {
        // 予定の欄を出さない表示の種類（期間が過ぎた・終了した旅行）は
        // 欄のクエリを出さず、欄自体をnullにする。
        if (context.targetDate === null) {
          return null;
        }
        const views = await ctx.schedule.listForDay(
          trip.id,
          LocalDate.parse(context.targetDate),
        );
        return toSchedule(views, context.targetDate);
      });
      const balanceResult = await ctx.runSection(() =>
        ctx.balance.findSummary(trip.id, roster),
      );
      const recentRecordsResult = await ctx.runSection(async () => [
        ...(await ctx.records.listRecent(trip.id, roster)),
      ]);

      return {
        trip: toTripDto(trip),
        context,
        schedule: this.toSection(scheduleResult, "schedule"),
        balance: this.toSection(balanceResult, "balance"),
        recentRecords: this.toSection(recentRecordsResult, "recentRecords"),
        fetchedAt: this.clock.now().toISOString(),
      };
    });
  }

  /**
   * 欄の読み取り結果を契約の形にする。失敗は欄の名前と誤りの種類を
   * warnで残して`unavailable`にし、ほかの欄はそのまま返す。
   */
  private toSection<T>(
    result: HomeSectionResult<T>,
    section: HomeSectionName,
  ): HomeSection<T> {
    if (result.status === "ok") {
      return { status: "ok", data: result.data };
    }
    this.log.warn({ section, errorKind: errorKindOf(result.error) });
    return { status: "unavailable", code: "TEMPORARILY_UNAVAILABLE" };
  }
}

/**
 * 表示の種類と案内する操作を日本時間の今日と旅行から決める
 * （詳細設計「表示の種類」）。終了していれば日付に関わらずcompleted。
 */
function contextOf(trip: Trip, today: LocalDate): Context {
  if (trip.status === "finished") {
    return {
      today,
      mode: "completed",
      targetDate: null,
      dayNumber: null,
      daysUntilStart: null,
      suggestedAction: null,
    };
  }
  if (LocalDate.compare(today, trip.period.startsOn) < 0) {
    return {
      today,
      mode: "before",
      targetDate: trip.period.startsOn,
      dayNumber: null,
      daysUntilStart: LocalDate.daysBetween(today, trip.period.startsOn),
      suggestedAction: null,
    };
  }
  if (LocalDate.compare(today, trip.period.endsOn) <= 0) {
    return {
      today,
      mode: "during",
      targetDate: today,
      dayNumber: LocalDate.daysBetween(trip.period.startsOn, today) + 1,
      daysUntilStart: null,
      suggestedAction: suggestedActionOf(trip.status),
    };
  }
  return {
    today,
    mode: "after_dates",
    targetDate: null,
    dayNumber: null,
    daysUntilStart: null,
    suggestedAction: suggestedActionOf(trip.status),
  };
}

/**
 * 期間中・期間が過ぎた旅行の、画面が案内する次の操作。
 * 計画中は旅行の開始、旅行中は終了。出発前と終了後はnull。
 */
function suggestedActionOf(status: TripStatus): Context["suggestedAction"] {
  return status === "planning" ? "start" : "finish";
}

/**
 * 予定の欄を組み立てる。取りやめていない予定のうち、達成済みでない
 * ものを先に（一覧の並びのまま）、達成済みを末尾に足して最大3件。
 * 一覧はすでに時刻の早い順・未定は末尾・登録日時・idの順なので、
 * 並べ替えず分けて戻すだけでよい。
 */
function toSchedule(views: readonly PlanView[], date: string): Schedule {
  const active = views.filter((view) => view.plan.cancelledAt === null);
  const unachieved = active.filter((view) => view.achievement === null);
  const achieved = active.filter((view) => view.achievement !== null);
  const items = [...unachieved, ...achieved].slice(0, 3);
  return {
    date,
    items: items.map((view) => toPlanDto(view.plan, view)),
    totalCount: active.length,
    achievedCount: achieved.length,
  };
}

function errorKindOf(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${error.name}(${code})` : error.name;
  }
  return typeof error;
}
