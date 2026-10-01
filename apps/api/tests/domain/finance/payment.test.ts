import { describe, expect, it } from "vitest";
import { UserId } from "../../../src/common/domain/user-id";
import { PaymentYen } from "../../../src/common/domain/yen";
import { Payment } from "../../../src/modules/record/domain/payment";

const TRIP_ID = "00000000-0000-4000-8000-000000000001";
const CREATED_BY = UserId.parse("00000000-0000-4000-8000-000000000002");

function createPayment(input: {
  amount: string;
  payerSlot: 0 | 1;
  slot0Percent: number;
}) {
  return Payment.create({
    tripId: TRIP_ID,
    planId: null,
    amount: PaymentYen.parse(input.amount),
    payerSlot: input.payerSlot,
    slot0Percent: input.slot0Percent,
    label: null,
    createdBy: CREATED_BY,
  });
}

describe("Payment.create", () => {
  it.each([0, 1] as const)(
    "FU-02: 1,001 円の折半。払った人が参加者番号 %i のとき、払った人でない人 500 円・払った人 501 円",
    (payerSlot) => {
      const payment = createPayment({
        amount: "1001",
        payerSlot,
        slot0Percent: 50,
      });
      // 端数 1 円は払った人が負担する
      if (payerSlot === 0) {
        expect(payment.slot1Burden).toBe(500n);
        expect(payment.slot0Burden).toBe(501n);
      } else {
        expect(payment.slot0Burden).toBe(500n);
        expect(payment.slot1Burden).toBe(501n);
      }
      // 負担の和は金額に一致する
      expect(payment.slot0Burden + payment.slot1Burden).toBe(1001n);
    },
  );

  it.each([
    // [payerSlot, slot0Percent, slot0Burden, slot1Burden, contribution]
    [0, 0, 0n, 3000n, 3000n],
    [0, 100, 3000n, 0n, 0n],
    [1, 0, 0n, 3000n, 0n],
    [1, 100, 3000n, 0n, -3000n],
  ] as const)(
    "FU-03: 払った人 %i・0 の人の割合 %i%% のとき、負担は %s / %s で寄与は %s",
    (payerSlot, slot0Percent, slot0Burden, slot1Burden, contribution) => {
      const payment = createPayment({
        amount: "3000",
        payerSlot,
        slot0Percent,
      });
      expect(payment.slot0Burden).toBe(slot0Burden);
      expect(payment.slot1Burden).toBe(slot1Burden);
      expect(payment.contribution).toBe(contribution);
      expect(payment.slot0Burden + payment.slot1Burden).toBe(3000n);
    },
  );

  it("FU-04: 寄与の符号。払った人が 0 なら 1 の人の負担、1 なら 0 の人の負担の負値", () => {
    // 7,001 円・0 の人が 30%: 1 の人の負担は floor(7001×70/100)=4,900
    const paidBy0 = createPayment({
      amount: "7001",
      payerSlot: 0,
      slot0Percent: 30,
    });
    expect(paidBy0.slot1Burden).toBe(4900n);
    expect(paidBy0.contribution).toBe(4900n);
    // 0 の人の負担は floor(7001×30/100)=2,100
    const paidBy1 = createPayment({
      amount: "7001",
      payerSlot: 1,
      slot0Percent: 30,
    });
    expect(paidBy1.slot0Burden).toBe(2100n);
    expect(paidBy1.contribution).toBe(-2100n);
  });

  it.each([-1, 101, 50.5, Number.NaN])(
    "FU-03: 割合 %s は 0〜100 の整数でないので拒否",
    (slot0Percent) => {
      expect(() =>
        createPayment({ amount: "3000", payerSlot: 0, slot0Percent }),
      ).toThrow();
    },
  );
});
