import { ApiError } from "../../../common/http/api-error";
import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import {
  CREATE_TRIP_OPERATION,
  type CreateTripInput,
  type CreateTripInputPort,
} from "../adapter/inbound/create-trip.input-port";
import type { TripWriteResult } from "../adapter/inbound/trip-write.result";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { parseTripName, parseTripPeriod } from "./trip-input";
import { toTripDto } from "./trip-dto";
import {
  executeTripWrite,
  isUniqueViolation,
  storedReceipt,
  type TripWriteOutcome,
} from "./trip-write-flow";

/**
 * 旅行の作成。ロックする旅行がまだ無いため、旅行行ロックの代わりに
 * allowlist の二人を読む（設計書「書き込みの共通の流れ」）。
 */
export class CreateTripUseCase implements CreateTripInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: CreateTripInput): Promise<TripWriteResult> {
    return executeTripWrite(this.writeLog, CREATE_TRIP_OPERATION, null, () =>
      this.run(input),
    );
  }

  private async run(input: CreateTripInput): Promise<TripWriteOutcome> {
    const name = parseTripName(input.name);
    const period = parseTripPeriod(input.startsOn, input.endsOn);
    try {
      return await this.unitOfWork.run(async (ctx) => {
        // allowlist の行はロックしない（行ロックは UPDATE 権限が要り、
        // app_runtime の allowlist の UPDATE は M1 で禁止されている。差分 1）。
        const participants = await ctx.participants.listEnabled();
        if (participants.length !== 2) {
          throw new ApiError({
            code: "PARTICIPANTS_NOT_READY",
            status: 409,
            message: "The two participants are not ready",
          });
        }
        const stored = await storedReceipt(
          ctx,
          input.userId,
          CREATE_TRIP_OPERATION,
          input.key,
          input.requestHash,
        );
        if (stored !== null) {
          return stored;
        }
        // 旅行・参加者・財務ガード・receipt はすべてこのトランザクションで
        // 作る。どれかが失敗すれば全体がロールバックされる。
        const trip = await ctx.trips.insert({
          name,
          period,
          createdBy: input.userId,
        });
        await ctx.trips.insertParticipants(trip.id, participants);
        await ctx.financeGuards.create(trip.id);
        const body = toTripDto(trip);
        await ctx.receipts.insert({
          actorId: input.userId,
          operation: CREATE_TRIP_OPERATION,
          idempotencyKey: input.key,
          tripId: trip.id,
          requestHash: input.requestHash,
          resourceType: "trip",
          resourceId: trip.id,
          httpStatus: 201,
          responseBody: body,
        });
        return { httpStatus: 201, body, replayed: false };
      });
    } catch (error) {
      // 同じキーの同時作成は receipt の PK 違反で負ける側が分かる（E-17）。
      // その時点でこちらはロールバック済み。勝った側が COMMIT した receipt を
      // 新しいトランザクションで読み直して同じ結果を返す。
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.unitOfWork.run(async (ctx) => {
        const stored = await storedReceipt(
          ctx,
          input.userId,
          CREATE_TRIP_OPERATION,
          input.key,
          input.requestHash,
        );
        if (stored === null) {
          throw error;
        }
        return stored;
      });
    }
  }
}
