import { describe, expect, it } from "vitest";
import { PaymentYen, SignedYen } from "../../src/common/domain/yen";
import type { IdempotencyKey } from "../../src/common/http/idempotency-key";
import type { CommandReceipt } from "../../src/common/idempotency/command-receipt";
import type { NotificationEvent } from "../../src/modules/notification/domain/notification-event";
import type { NotificationPublisher } from "../../src/modules/planning/adapter/outbound/notification-publisher";
import { CANCEL_PLAN_OPERATION } from "../../src/modules/planning/adapter/inbound/cancel-plan.input-port";
import { CREATE_PLAN_OPERATION } from "../../src/modules/planning/adapter/inbound/create-plan.input-port";
import { MOVE_PLAN_OPERATION } from "../../src/modules/planning/adapter/inbound/move-plan.input-port";
import { CancelPlanUseCase } from "../../src/modules/planning/usecase/cancel-plan.usecase";
import { CreatePlanUseCase } from "../../src/modules/planning/usecase/create-plan.usecase";
import { MovePlanUseCase } from "../../src/modules/planning/usecase/move-plan.usecase";
import { createPlanEventOperation } from "../../src/modules/record/adapter/inbound/create-plan-event.input-port";
import { CREATE_PAYMENT_OPERATION } from "../../src/modules/record/adapter/inbound/create-payment.input-port";
import { CancelPaymentUseCase } from "../../src/modules/record/usecase/cancel-payment.usecase";
import { CancelPlanEventUseCase } from "../../src/modules/record/usecase/cancel-plan-event.usecase";
import { CreatePaymentUseCase } from "../../src/modules/record/usecase/create-payment.usecase";
import { CreatePlanEventUseCase } from "../../src/modules/record/usecase/create-plan-event.usecase";
import { Payment } from "../../src/modules/record/domain/payment";
import type { PreviewRecord } from "../../src/modules/settlement/adapter/outbound/settlement.repository";
import {
  EMPTY_CLAIM_HISTORY,
  fingerprintOf,
} from "../../src/modules/settlement/domain/fingerprint";
import { CancelSettlementUseCase } from "../../src/modules/settlement/usecase/cancel-settlement.usecase";
import { CompleteSettlementUseCase } from "../../src/modules/settlement/usecase/complete-settlement.usecase";
import {
  ACTOR,
  KEY,
  PARTNER,
  RecordingWriteLog,
  testPlan,
  testTrip,
  InMemoryPlanningContext,
  inMemoryUnitOfWork,
  fixedClock,
} from "../support/planning-context";
import {
  InMemoryFinanceContext,
  inMemoryFinanceUnitOfWork,
  PLAN_ID,
  TRIP_ID,
} from "../support/finance-context";
import {
  InMemoryPlanEventContext,
  inMemoryPlanEventUnitOfWork,
} from "../support/plan-event-context";
import {
  InMemorySettlementContext,
  inMemorySettlementUnitOfWork,
  previewItemOf,
} from "../support/settlement-context";

const PAYMENT_ID = "77777777-7777-4777-8777-000000000001";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const PREVIEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const SETTLEMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const OTHER_KEY = "22222222-2222-4222-8222-222222222222" as IdempotencyKey;

/** publishされたイベントを集める偽物。 */
class RecordingPublisher implements NotificationPublisher {
  readonly events: NotificationEvent[] = [];
  publish(event: NotificationEvent): void {
    this.events.push(event);
  }
}

function receiptOf(
  operation: string,
  resourceType: string,
  resourceId: string,
  requestHash = "hash-x",
): CommandReceipt {
  return {
    actorId: ACTOR,
    operation,
    idempotencyKey: KEY,
    tripId: TRIP_ID,
    requestHash,
    resourceType,
    resourceId,
    httpStatus: 201,
    responseBody: { stored: true },
  };
}

function storedPayment(): Payment {
  const created = Payment.create({
    tripId: TRIP_ID,
    planId: null,
    amount: PaymentYen.parse("7001"),
    payerSlot: 0,
    slot0Percent: 50,
    label: null,
    createdBy: ACTOR,
  });
  return {
    ...created,
    id: PAYMENT_ID,
    createdAt: new Date("2026-09-05T12:00:00.000Z"),
  };
}

function expectPushEvent(
  event: NotificationEvent | undefined,
  action: NotificationEvent["action"],
  targetKind: NotificationEvent["targetKind"],
  targetId: string,
): void {
  expect(event).toBeDefined();
  expect(event?.action).toBe(action);
  expect(event?.targetKind).toBe(targetKind);
  expect(event?.tripId).toBe(TRIP_ID);
  expect(event?.targetId).toBe(targetId);
  expect(event?.actorUserId).toBe(ACTOR);
  // eventIdは操作ごとに新しいUUID。
  expect(event?.eventId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  // occurredAtはISO 8601。
  expect(() => new Date(event?.occurredAt ?? "")).not.toThrow();
}

/**
 * PU-10（イベントを渡すとき）: 11種類のUseCaseが、再送・状態が変わらない
 * 結果のときにpublishしない。状態が変わった成功だけがイベントを渡す。
 */
describe("通知のイベントを渡す判定（PU-10）", () => {
  describe("planning", () => {
    function planningSetup() {
      const ctx = new InMemoryPlanningContext();
      const uow = inMemoryUnitOfWork(ctx);
      const writeLog = new RecordingWriteLog();
      const publisher = new RecordingPublisher();
      ctx.seedTrip(testTrip(), [ACTOR, PARTNER]);
      ctx.seedPlan(testPlan());
      return { ctx, uow, writeLog, publisher };
    }

    it("予定の追加: 保存できると publish し、再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = planningSetup();
      const usecase = new CreatePlanUseCase(
        uow,
        fixedClock(),
        writeLog,
        publisher,
      );
      const input = {
        userId: ACTOR,
        tripId: TRIP_ID,
        key: KEY,
        requestHash: "hash-x",
        name: "金閣寺",
        kind: "place" as const,
        date: "2026-09-12",
        time: null,
        memo: null,
      };
      const created = await usecase.execute(input);
      expect(created.httpStatus).toBe(201);
      expect(publisher.events).toHaveLength(1);
      expectPushEvent(
        publisher.events[0],
        "plan_added",
        "plan",
        created.body.id,
      );

      // 同じキーの再送は元の結果を返すだけ（publishしない）。
      ctx.seedReceipt(receiptOf(CREATE_PLAN_OPERATION, "plan", PLAN_ID));
      await usecase.execute(input);
            expect(publisher.events).toHaveLength(1);
    });

    it("予定の取りやめ: 取りやめに変わったときだけ publish し、再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = planningSetup();
      const usecase = new CancelPlanUseCase(
        uow,
        fixedClock(),
        writeLog,
        publisher,
      );
      const input = {
        userId: ACTOR,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        key: KEY,
        requestHash: "hash-x",
        ifMatch: "1",
      };
      const result = await usecase.execute(input);
      expect(result.httpStatus).toBe(200);
      expectPushEvent(
        publisher.events[0],
        "plan_cancelled",
        "plan",
        PLAN_ID,
      );

      ctx.seedReceipt(
        receiptOf(CANCEL_PLAN_OPERATION, "plan", PLAN_ID, "hash-x"),
      );
      await usecase.execute(input);
            expect(publisher.events).toHaveLength(1);
    });

    it("予定の日の移動: 日が変わると publish し、同じ日・再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = planningSetup();
      const usecase = new MovePlanUseCase(
        uow,
        fixedClock(),
        writeLog,
        publisher,
      );
      // 今の日（2026-09-11）と同じ日への移動は変化なし → publishしない。
      const sameDay = await usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        key: KEY,
        requestHash: "hash-same",
        ifMatch: "1",
        date: "2026-09-11",
      });
      expect(sameDay.httpStatus).toBe(200);
      expect(publisher.events).toHaveLength(0);

      // 別の日への移動は publish する。
      const moved = await usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        key: OTHER_KEY,
        requestHash: "hash-move",
        ifMatch: "1",
        date: "2026-09-12",
      });
      expect(moved.httpStatus).toBe(200);
      expectPushEvent(publisher.events[0], "plan_moved", "plan", PLAN_ID);

      // 再送は publish しない。
      ctx.seedReceipt(
        receiptOf(MOVE_PLAN_OPERATION, "plan", PLAN_ID, "hash-x"),
      );
      await usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        key: KEY,
        requestHash: "hash-x",
        ifMatch: "1",
        date: "2026-09-13",
      });
            expect(publisher.events).toHaveLength(1);
    });
  });

  describe("record", () => {
    function planEventSetup() {
      const ctx = new InMemoryPlanEventContext();
      const uow = inMemoryPlanEventUnitOfWork(ctx);
      const writeLog = new RecordingWriteLog();
      const publisher = new RecordingPublisher();
      ctx.seedTrip();
      ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
      return { ctx, uow, writeLog, publisher };
    }

    it("達成・予約を付ける: 新しい記録だけ publish し、再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = planEventSetup();
      const usecase = new CreatePlanEventUseCase(uow, writeLog, publisher);
      const input = {
        userId: ACTOR,
        tripId: TRIP_ID,
        eventKind: "achievement" as const,
        planId: PLAN_ID,
        key: KEY,
        requestHash: "hash-x",
      };
      const created = await usecase.execute(input);
      expect(created.httpStatus).toBe(201);
      expectPushEvent(
        publisher.events[0],
        "achievement_added",
        "achievement",
        created.body.id,
      );

      ctx.seedReceipt(
        receiptOf(
          createPlanEventOperation("achievement"),
          "plan_event",
          created.body.id,
        ),
      );
      await usecase.execute(input);
            expect(publisher.events).toHaveLength(1);
    });

    it("達成・予約の取り消し: 新しい取り消しだけ publish し、既にある200と再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = planEventSetup();
      ctx.seedEvent({
        id: EVENT_ID,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        kind: "booking",
        createdBy: PARTNER,
        createdAt: new Date("2026-09-05T12:00:00.000Z"),
      });
      ctx.seedActive(PLAN_ID, "booking", EVENT_ID);
      const usecase = new CancelPlanEventUseCase(uow, writeLog, publisher);

      const cancelled = await usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        eventKind: "booking",
        recordId: EVENT_ID,
        key: KEY,
        requestHash: "hash-x",
      });
      expect(cancelled.httpStatus).toBe(201);
      expectPushEvent(
        publisher.events[0],
        "booking_cancelled",
        "booking",
        EVENT_ID,
      );

      // 別キーの再取り消しは既存の取り消しを200で返す → publishしない。
      const again = await usecase.execute({
        userId: PARTNER,
        tripId: TRIP_ID,
        eventKind: "booking",
        recordId: EVENT_ID,
        key: OTHER_KEY,
        requestHash: "hash-y",
      });
      expect(again.httpStatus).toBe(200);
      expect(publisher.events).toHaveLength(1);

      // 同じキーの再送も publish しない。
      await usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        eventKind: "booking",
        recordId: EVENT_ID,
        key: KEY,
        requestHash: "hash-x",
      });
            expect(publisher.events).toHaveLength(1);
    });

    function financeSetup() {
      const ctx = new InMemoryFinanceContext();
      const uow = inMemoryFinanceUnitOfWork(ctx);
      const writeLog = new RecordingWriteLog();
      const publisher = new RecordingPublisher();
      ctx.seedTrip();
      return { ctx, uow, writeLog, publisher };
    }

    const paymentInput = {
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-x",
      amountYen: "7001",
      payerUserId: ACTOR as string,
      allocations: [
        { userId: ACTOR as string, percent: 50 },
        { userId: PARTNER as string, percent: 50 },
      ],
      label: null,
      planId: null,
    };

    it("支払いの記録: 保存できると publish し、再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = financeSetup();
      const usecase = new CreatePaymentUseCase(uow, writeLog, publisher);
      const created = await usecase.execute(paymentInput);
      expect(created.httpStatus).toBe(201);
      expectPushEvent(
        publisher.events[0],
        "payment_added",
        "payment",
        created.body.id,
      );

      ctx.seedReceipt(
        receiptOf(CREATE_PAYMENT_OPERATION, "payment", PAYMENT_ID),
      );
      await usecase.execute(paymentInput);
            expect(publisher.events).toHaveLength(1);
    });

    it("支払いの取り消し: 新しい取り消しだけ publish し、既にある200と再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = financeSetup();
      ctx.seedPayment(storedPayment());
      const usecase = new CancelPaymentUseCase(uow, writeLog, publisher);
      const input = {
        userId: ACTOR,
        tripId: TRIP_ID,
        paymentId: PAYMENT_ID,
        key: KEY,
        requestHash: "hash-x",
      };
      const cancelled = await usecase.execute(input);
      expect(cancelled.httpStatus).toBe(201);
      expectPushEvent(
        publisher.events[0],
        "payment_cancelled",
        "payment",
        PAYMENT_ID,
      );

      // 別キーの再取り消しは既存の取り消しを200で返す → publishしない。
      const again = await usecase.execute({
        ...input,
        userId: PARTNER,
        key: OTHER_KEY,
        requestHash: "hash-y",
      });
      expect(again.httpStatus).toBe(200);
      expect(publisher.events).toHaveLength(1);

      // 同じキーの再送も publish しない。
      await usecase.execute(input);
            expect(publisher.events).toHaveLength(1);
    });
  });

  describe("settlement", () => {
    function settlementSetup() {
      const ctx = new InMemorySettlementContext();
      const uow = inMemorySettlementUnitOfWork(ctx);
      const writeLog = new RecordingWriteLog();
      const publisher = new RecordingPublisher();
      ctx.seedTrip();
      return { ctx, uow, writeLog, publisher };
    }

    const completeInput = {
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-x",
      previewId: PREVIEW_ID,
      completionKind: "transfer_completed" as const,
      acknowledgedCancellationPaymentIds: [] as string[],
    };

    function seedPreview(ctx: InMemorySettlementContext): void {
      const preview: PreviewRecord = {
        id: PREVIEW_ID,
        tripId: TRIP_ID,
        createdBy: PARTNER,
        createdAt: new Date("2026-09-06T12:00:00.000Z"),
        signedTotal: SignedYen.fromBigInt(3500n),
      };
      ctx.previewRows.set(PREVIEW_ID, preview);
      ctx.previewItemRows.set(PREVIEW_ID, [
        previewItemOf({
          expectedFingerprint: fingerprintOf(EMPTY_CLAIM_HISTORY),
        }),
      ]);
    }

    it("精算の記録: 新しい精算だけ publish し、先に完了した200と再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = settlementSetup();
      ctx.seedPayment(storedPayment());
      seedPreview(ctx);
      const usecase = new CompleteSettlementUseCase(uow, writeLog, publisher);

      const completed = await usecase.execute(completeInput);
      expect(completed.httpStatus).toBe(201);
      expect(publisher.events).toHaveLength(1);
      expectPushEvent(
        publisher.events[0],
        "settlement_completed",
        "settlement",
        completed.body.id,
      );

      // 別キーで同じ確認を完了しようとすると、先に完了した精算を200で返す
      // → publishしない。
      const ctx2 = new InMemorySettlementContext();
      const uow2 = inMemorySettlementUnitOfWork(ctx2);
      const writeLog2 = new RecordingWriteLog();
      const publisher2 = new RecordingPublisher();
      ctx2.seedTrip();
      ctx2.seedPayment(storedPayment());
      seedPreview(ctx2);
      ctx2.seedSettlementForPreview(
        PREVIEW_ID,
        { id: SETTLEMENT_ID, cancelled: false },
        { sequence: 1 },
      );
      ctx2.seedSettlementItems(SETTLEMENT_ID, [
        {
          paymentId: PAYMENT_ID,
          kind: "BASE",
          contribution: SignedYen.fromBigInt(3500n),
          baseSettlementId: null,
        },
      ]);
      const again = await new CompleteSettlementUseCase(
        uow2,
        writeLog2,
        publisher2,
      ).execute({ ...completeInput, key: OTHER_KEY, requestHash: "hash-y" });
      expect(again.httpStatus).toBe(200);
      expect(publisher2.events).toHaveLength(0);

      // 同じキーの再送も publish しない。
      const replayed = await usecase.execute(completeInput);
      expect(replayed.httpStatus).toBe(201);
            expect(publisher.events).toHaveLength(1);
    });

    it("精算の取り消し: 新しい取り消しだけ publish し、既にある200と再送は publish しない", async () => {
      const { ctx, uow, writeLog, publisher } = settlementSetup();
      ctx.seedPayment(storedPayment());
      ctx.seedSettlement({ id: SETTLEMENT_ID });
      const usecase = new CancelSettlementUseCase(uow, writeLog, publisher);
      const input = {
        userId: ACTOR,
        tripId: TRIP_ID,
        settlementId: SETTLEMENT_ID,
        key: KEY,
        requestHash: "hash-x",
      };
      const cancelled = await usecase.execute(input);
      expect(cancelled.httpStatus).toBe(201);
      expectPushEvent(
        publisher.events[0],
        "settlement_cancelled",
        "settlement",
        SETTLEMENT_ID,
      );

      // 別キーの再取り消しは既存の取り消しを200で返す → publishしない。
      const again = await usecase.execute({
        ...input,
        userId: PARTNER,
        key: OTHER_KEY,
        requestHash: "hash-y",
      });
      expect(again.httpStatus).toBe(200);
      expect(publisher.events).toHaveLength(1);

      // 同じキーの再送も publish しない。
      await usecase.execute(input);
            expect(publisher.events).toHaveLength(1);
    });
  });
});
