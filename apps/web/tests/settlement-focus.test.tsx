import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettlementHistory } from "@/features/settlement/ui/settlement-history";
import { parseFocusSettlementId } from "@/screens/settlement/focus-settlement-id";

/**
 * PW-11: 精算の画面の`settlementId`。履歴にあればその行を目立たせて
 * スクロール、無ければふつうに出す、形が違えば無視する（F-52）。
 */

const settlementId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const otherId = "11111111-2222-4333-8444-555555555555";
const userId = "550e8400-e29b-41d4-a716-446655440000";
const otherUserId = "3f7c1f68-9c05-4f2e-9b4c-2d5b1a90f811";

const participants = [
  { userId, slot: 0 as const, displayName: "ひなた" },
  { userId: otherUserId, slot: 1 as const, displayName: "あおい" },
];

function settlement(overrides: Record<string, unknown> = {}) {
  return {
    id: settlementId,
    transfer: {
      signedTotalYen: "-1285",
      amountYen: "1285",
      fromUserId: userId,
      toUserId: otherUserId,
      requiresTransfer: true,
    },
    createdAt: "2026-10-07T10:00:00.000Z",
    cancellation: null,
    ...overrides,
  } as never;
}

const scrollIntoViewMock = vi.fn();
Element.prototype.scrollIntoView = scrollIntoViewMock;

afterEach(() => {
  cleanup();
});

describe("PW-11 精算のsettlementId", () => {
  it("履歴にあればその行に枠を付けてスクロールする", () => {
    scrollIntoViewMock.mockClear();
    render(
      <SettlementHistory
        settlements={[
          settlement(),
          settlement({ id: otherId, createdAt: "2026-10-01T10:00:00.000Z" }),
        ]}
        participants={participants}
        focusSettlementId={settlementId}
      />,
    );
    // 行は役割と順番で探し、目立たせた行はaria-currentで確かめる。
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const focused = rows.find(
      (li) => li.getAttribute("aria-current") === "true",
    );
    expect(focused).toBe(rows[0]);
    expect(focused?.className).toContain("settle-row-focused");
    expect(scrollIntoViewMock).toHaveBeenCalled();
    // 別の行は目立たせない。
    expect(rows[1].getAttribute("aria-current")).toBeNull();
  });

  it("履歴に無ければふつうに出す（スクロールもしない）", () => {
    scrollIntoViewMock.mockClear();
    render(
      <SettlementHistory
        settlements={[settlement()]}
        participants={participants}
        focusSettlementId="99999999-8888-4777-8666-555555555555"
      />,
    );
    expect(
      document.querySelector('[aria-current="true"]'),
    ).toBeNull();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("focusがnullならふつうに出す", () => {
    scrollIntoViewMock.mockClear();
    render(
      <SettlementHistory
        settlements={[settlement()]}
        participants={participants}
      />,
    );
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });
});

describe("PW-11 settlementIdの形の確かめ", () => {
  it("UUIDの形のときだけ値を返し、形が違えば無視する", () => {
    expect(parseFocusSettlementId(settlementId)).toBe(settlementId);
    expect(parseFocusSettlementId([settlementId, "x"])).toBe(settlementId);
    expect(parseFocusSettlementId("not-a-uuid")).toBeNull();
    expect(parseFocusSettlementId("../../etc/passwd")).toBeNull();
    expect(parseFocusSettlementId("")).toBeNull();
    expect(parseFocusSettlementId([])).toBeNull();
    expect(parseFocusSettlementId(null)).toBeNull();
  });
});
