import { describe, expect, it } from "vitest";
import { SignedYen } from "../../../src/common/domain/yen";
import { balanceOf } from "../../../src/modules/settlement/domain/balance";
import {
  fingerprintOf,
  type ClaimFingerprint,
  type ClaimHistory,
} from "../../../src/modules/settlement/domain/fingerprint";
import {
  deriveTargets,
  type ActiveClaim,
  type ClaimKind,
  type SettlementTarget,
} from "../../../src/modules/settlement/domain/settlement-target";

/**
 * FU-09: 正本のモデル`finance_model_check.py`の筋書きをTypeScriptの
 * 単体試験に移したもの。占有・履歴の操作はこのインメモリの模型が持ち、
 * 対象の導出・指紋・残額は本物のDomainを呼ぶ。モデル中のepochs
 * （履歴の変化を表す簡略化した値）の役割は、実物の指紋が担う。
 */

/** モデルのAssertionErrorに相当する、業務の拒否。 */
class Rejection extends Error {
  constructor(code: string) {
    super(code);
    this.name = "Rejection";
  }
}

function rejects(fn: () => unknown, code: string): void {
  let caught: unknown = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Rejection);
  expect((caught as Rejection).message).toBe(code);
}

function yen(value: bigint): SignedYen {
  return SignedYen.fromBigInt(value);
}

type Preview = Readonly<{
  items: readonly SettlementTarget[];
  /** 支払いごとの、確認を作った時点の指紋。 */
  fingerprints: ReadonlyMap<string, ClaimFingerprint>;
}>;

class Model {
  private readonly payments = new Map<
    string,
    { contribution: SignedYen; cancelled: boolean }
  >();
  private readonly claims = new Map<string, ActiveClaim>();
  private readonly itemHistory = new Map<
    string,
    { settlementId: string; kind: ClaimKind }[]
  >();
  private readonly settlements: {
    items: readonly SettlementTarget[];
    cancelled: boolean;
  }[] = [];

  private claimKey(paymentId: string, kind: ClaimKind): string {
    return `${paymentId}:${kind}`;
  }

  add(paymentId: string, contribution: SignedYen): void {
    expect(this.payments.has(paymentId)).toBe(false);
    this.payments.set(paymentId, { contribution, cancelled: false });
    this.itemHistory.set(paymentId, []);
  }

  cancelPayment(paymentId: string): void {
    this.payments.get(paymentId)!.cancelled = true;
  }

  candidates(): SettlementTarget[] {
    return deriveTargets(
      [...this.payments.entries()].map(([id, p]) => ({
        id,
        contribution: p.contribution,
      })),
      new Set(
        [...this.payments.entries()]
          .filter(([, p]) => p.cancelled)
          .map(([id]) => id),
      ),
      [...this.claims.values()],
    );
  }

  private historyOf(paymentId: string): ClaimHistory {
    const activeClaims: Partial<Record<ClaimKind, string>> = {};
    for (const claim of this.claims.values()) {
      if (claim.paymentId === paymentId) {
        activeClaims[claim.kind] = claim.settlementId;
      }
    }
    const cancelledSettlementIds: string[] = [];
    for (const [index, settlement] of this.settlements.entries()) {
      if (
        settlement.cancelled &&
        settlement.items.some((item) => item.paymentId === paymentId)
      ) {
        cancelledSettlementIds.push(`s${index}`);
      }
    }
    return {
      activeClaims,
      items: this.itemHistory.get(paymentId)!,
      cancelledSettlementIds,
    };
  }

  preview(): Preview {
    const items = this.candidates();
    if (items.length === 0) {
      throw new Rejection("NO_TARGETS");
    }
    return {
      items,
      fingerprints: new Map(
        items.map((item) => [
          item.paymentId,
          fingerprintOf(this.historyOf(item.paymentId)),
        ]),
      ),
    };
  }

  complete(preview: Preview, acknowledge = false): number {
    for (const item of preview.items) {
      // 完了時点で指紋を作り直して比べる。違えば「対象が変わった」
      if (
        fingerprintOf(this.historyOf(item.paymentId)) !==
        preview.fingerprints.get(item.paymentId)
      ) {
        throw new Rejection("TARGET_CHANGED");
      }
      if (this.claims.has(this.claimKey(item.paymentId, item.kind))) {
        throw new Rejection("DUPLICATE");
      }
      if (
        item.kind === "BASE" &&
        this.payments.get(item.paymentId)!.cancelled &&
        !acknowledge
      ) {
        throw new Rejection("ACK_REQUIRED");
      }
    }
    const sid = this.settlements.length;
    this.settlements.push({ items: preview.items, cancelled: false });
    for (const item of preview.items) {
      this.claims.set(this.claimKey(item.paymentId, item.kind), {
        paymentId: item.paymentId,
        kind: item.kind,
        settlementId: `s${sid}`,
      });
      this.itemHistory.get(item.paymentId)!.push({
        settlementId: `s${sid}`,
        kind: item.kind,
      });
    }
    return sid;
  }

  cancelSettlement(sid: number): void {
    const settlement = this.settlements[sid]!;
    if (settlement.cancelled) {
      return;
    }
    let latest = -1;
    for (const [index, s] of this.settlements.entries()) {
      if (!s.cancelled) {
        latest = index;
      }
    }
    if (sid !== latest) {
      throw new Rejection("NOT_LATEST");
    }
    for (const item of settlement.items) {
      this.claims.delete(this.claimKey(item.paymentId, item.kind));
    }
    settlement.cancelled = true;
  }

  /**
   * モデルの不変条件: 今の対象の合計 = 有効な支払いの寄与の合計 −
   * 有効な精算で済ませた分の合計。
   */
  check(expected: SignedYen): void {
    const pending = balanceOf(this.candidates()).signedTotal;
    let obligations = 0n;
    for (const p of this.payments.values()) {
      if (!p.cancelled) {
        obligations += p.contribution;
      }
    }
    let transfers = 0n;
    for (const settlement of this.settlements) {
      if (settlement.cancelled) {
        continue;
      }
      for (const item of settlement.items) {
        transfers += item.contribution;
      }
    }
    expect(pending).toBe(yen(obligations - transfers));
    expect(pending).toBe(expected);
  }
}

describe("FU-09: 正本のモデルの筋書き", () => {
  it.each([true, false])(
    "支払いの取り消しと精算の取り消しの順を入れ替えても最後の残額が一致する（支払いを先に取り消す: %s）",
    (paymentFirst) => {
      const m = new Model();
      m.add("p", yen(3000n));
      const s = m.complete(m.preview());
      if (paymentFirst) {
        m.cancelPayment("p");
        m.check(yen(-3000n));
        m.cancelSettlement(s);
      } else {
        m.cancelSettlement(s);
        m.check(yen(3000n));
        m.cancelPayment("p");
      }
      m.check(yen(0n));
      // 重複の取り消しは何も変えない
      m.cancelPayment("p");
      m.cancelSettlement(s);
      m.check(yen(0n));
    },
  );

  it("確認のあとに追加された支払いはその確認に入らず、同じ確認の二度目の完了は対象の変化で拒否される", () => {
    const m = new Model();
    m.add("p", yen(3000n));
    const old = m.preview();
    m.add("new", yen(2000n));
    m.complete(old);
    m.check(yen(2000n));
    rejects(() => m.complete(old), "TARGET_CHANGED");
  });

  it("確認のあとに対象の支払いが取り消されたとき、了承があれば完了できて戻しは一度だけ出る", () => {
    const m = new Model();
    m.add("p", yen(3000n));
    const old = m.preview();
    m.cancelPayment("p");
    m.add("correct", yen(2000n));
    rejects(() => m.complete(old), "ACK_REQUIRED");
    const s1 = m.complete(old, true);
    m.check(yen(-1000n));
    const s2 = m.complete(m.preview());
    m.check(yen(0n));
    // 取り消せるのは最新の有効な精算だけ
    rejects(() => m.cancelSettlement(s1), "NOT_LATEST");
    m.cancelSettlement(s2);
    m.check(yen(-1000n));
    m.cancelSettlement(s1);
    m.check(yen(2000n));
    m.complete(m.preview());
    m.check(yen(0n));
  });

  it("0 円の対象も精算で締められ、取り消しの戻し（−0 円）も一度だけ出る", () => {
    const m = new Model();
    m.add("zero", yen(0n));
    const old = m.preview();
    expect(old.items).toHaveLength(1);
    const s = m.complete(old);
    expect(m.candidates()).toHaveLength(0);
    m.check(yen(0n));
    m.cancelPayment("zero");
    expect(m.candidates()).toHaveLength(1);
    m.cancelSettlement(s);
    expect(m.candidates()).toHaveLength(0);
    m.check(yen(0n));
  });

  it("精算を取り消して占有が元に戻っても、履歴が変わった古い確認は拒否される", () => {
    const m = new Model();
    m.add("p", yen(3000n));
    const old = m.preview();
    const s = m.complete(m.preview());
    m.cancelSettlement(s);
    rejects(() => m.complete(old), "TARGET_CHANGED");
    m.complete(m.preview());
    m.check(yen(0n));
  });
});
