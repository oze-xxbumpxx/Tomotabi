// docs/tests/payments-and-settlement.md の FE-01（ふつうの精算）・FE-02（0円の精算）・
// FE-03（確認の固定）を実APIつなぎで検証する。
// 支払いの記録 → 精算の目安 → 受け渡しの確認 → 記録まで、実物のデータだけを通す。

import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { createTrip } from "../support/trips";

type PaymentInput = {
  /** 金額（円）を半角数字で入れる。入力欄は桁区切りを受け付けない。 */
  amount: string;
  /** 用途。空欄の支払いは名前が「支払い」になる。 */
  label?: string;
  /** 払った人として選ぶ相手の選択肢名。省略時はログイン中の本人のまま。 */
  payerName?: string;
};

/**
 * しおりの画面から「支払いを記録」を開き、入力して保存し、
 * しおりへ戻るところまで進める。
 *
 * 「払った人」の選択肢は残額の取得を待ってから出るため、
 * 金額欄だけでなく本人の選択肢が決まるのを待ってから入力する
 * （先に入力すると後から来た選択肢の初期化と競合しうる）。
 */
async function recordPayment(page: Page, input: PaymentInput): Promise<void> {
  await page.getByRole("link", { name: "支払いを記録" }).click();
  const sheet = page.getByRole("dialog", { name: "支払いを記録" });
  await expect(sheet.getByLabel("金額")).toBeVisible();
  await expect(sheet.getByRole("radio", { name: /（自分）/ })).toBeChecked();
  if (input.payerName !== undefined) {
    // Segmented の radio は sr-only なので force で選ぶ。
    await sheet.getByRole("radio", { name: input.payerName, exact: true }).check({ force: true });
  }
  await sheet.getByLabel("金額").fill(input.amount);
  if (input.label !== undefined) {
    await sheet.getByLabel("用途").fill(input.label);
  }
  await sheet.getByRole("button", { name: "保存" }).click();
  await page.waitForURL(/\/trips\/[^/]+\/itinerary$/);
  await expect(
    page.getByRole("status").filter({ hasText: "支払いを記録しました" }),
  ).toBeVisible();
}

/** タブバーの「精算」から精算の画面を開く。 */
async function openSettlement(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "タブ" }).getByRole("link", { name: "精算" }).click();
  await expect(page.getByRole("heading", { name: "精算" })).toBeVisible();
}

test("FE-01: 支払いを2件記録して受け渡しを確認・記録する", async ({ hinataPage: page }) => {
  const tripId = await createTrip(page, {
    name: "宮島 1 泊",
    startsOn: "2026-11-14",
    endsOn: "2026-11-15",
  });

  // ひなたが 7,001 円（折半、あおいの負担 3,500 円）、あおいが 3,000 円（折半、ひなたの負担 1,500 円）。
  // 差し引きで あおい → ひなた 2,000 円 の受け渡しになる。
  await recordPayment(page, { amount: "7001", label: "レンタカー" });
  await recordPayment(page, { amount: "3000", label: "ランチ", payerName: "あおい" });

  await openSettlement(page);
  await expect(page.getByText("対象 2 件")).toBeVisible();
  await expect(page.getByText("レンタカー")).toBeVisible();
  await expect(page.getByText("ランチ")).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("2,000 円");

  // 受け渡しを確認する → 確認の作成 → 表示の全額を受け渡した → 記録する。
  await page.getByRole("button", { name: "受け渡しを確認する" }).click();
  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement/previews/[^/]+$`));
  await expect(page.getByRole("heading", { name: "受け渡しの確認" })).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("2,000 円");
  await expect(page.getByText(/対象 2 件/)).toBeVisible();
  await page.getByRole("checkbox", { name: "表示の全額を受け渡しました" }).check();
  await page.getByRole("button", { name: "受け渡し完了を記録" }).click();
  await page
    .getByRole("dialog", { name: "受け渡し完了を記録しますか？" })
    .getByRole("button", { name: "記録する" })
    .click();

  // 精算の画面へ戻り、受け渡しの対象が無くなり、履歴に残る。
  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement$`));
  await expect(
    page.getByRole("status").filter({ hasText: "今回の精算を記録しました" }),
  ).toBeVisible();
  await expect(page.getByText("現在、精算する対象はありません")).toBeVisible();
  await expect(page.getByText("あおい から ひなた へ 2,000 円")).toBeVisible();
});

test("FE-02: 互いに同額を立て替えたときは 0 円として精算を記録する", async ({
  hinataPage: page,
}) => {
  const tripId = await createTrip(page, {
    name: "鎌倉 1 泊",
    startsOn: "2026-11-21",
    endsOn: "2026-11-22",
  });

  // ひなた 4,000 円・あおい 4,000 円（ともに折半）→ 差し引き 0 円。
  await recordPayment(page, { amount: "4000", label: "電車代" });
  await recordPayment(page, { amount: "4000", label: "宿代", payerName: "あおい" });

  await openSettlement(page);
  await expect(page.getByText("対象 2 件")).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("0 円");
  await expect(page.getByText("受け渡しは不要です")).toBeVisible();

  // 受け渡し不要の対象を確認する → 確認の作成 → 記録する。
  await page.getByRole("button", { name: "受け渡し不要の対象を確認する" }).click();
  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement/previews/[^/]+$`));
  await expect(page.getByRole("heading", { name: "受け渡しの確認" })).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("0 円");
  await expect(page.getByText("受け渡しは不要です")).toBeVisible();
  // 受け渡し不要の確認には「受け渡しました」のチェックがない。
  await expect(
    page.getByRole("checkbox", { name: "表示の全額を受け渡しました" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "受け渡し不要として精算を記録" }).click();
  await page
    .getByRole("dialog", { name: "精算を記録しますか？" })
    .getByRole("button", { name: "記録する" })
    .click();

  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement$`));
  await expect(
    page.getByRole("status").filter({ hasText: "今回の精算を記録しました" }),
  ).toBeVisible();
  await expect(page.getByText("現在、精算する対象はありません")).toBeVisible();
  await expect(page.getByText("受け渡し不要として記録")).toBeVisible();
});

test("FE-03: 確認を作ったあとの支払いは確認の金額を変えない", async ({
  hinataPage: page,
  aoiPage,
}) => {
  const tripId = await createTrip(page, {
    name: "金沢 2 泊",
    startsOn: "2026-12-12",
    endsOn: "2026-12-14",
  });

  // ひなたが 1,000 円（折半）→ あおい → ひなた 500 円 の受け渡し。
  await recordPayment(page, { amount: "1000", label: "入場料" });
  await openSettlement(page);
  await expect(page.getByText("対象 1 件")).toBeVisible();
  await page.getByRole("button", { name: "受け渡しを確認する" }).click();
  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement/previews/[^/]+$`));
  await expect(page.locator(".settle-amount")).toHaveText("500 円");

  // 別の context（あおい）で支払いを 3,000 円（折半）足す。
  await aoiPage.goto(`/trips/${tripId}/itinerary`);
  await expect(aoiPage.getByRole("heading", { name: "金沢 2 泊" })).toBeVisible();
  await recordPayment(aoiPage, { amount: "3000", label: "カフェ" });

  // 確認を再読み込みしても、作った時点の対象と金額で固定されている。
  await page.reload();
  await expect(page.locator(".settle-amount")).toHaveText("500 円");
  await expect(page.getByText(/対象 1 件/)).toBeVisible();

  // 固定した確認はそのまま記録できる（ready のまま）。
  await page.getByRole("checkbox", { name: "表示の全額を受け渡しました" }).check();
  await page.getByRole("button", { name: "受け渡し完了を記録" }).click();
  await page
    .getByRole("dialog", { name: "受け渡し完了を記録しますか？" })
    .getByRole("button", { name: "記録する" })
    .click();

  // 残る対象はあおいが足した支払いだけ（ひなたの負担 1,500 円 → ひなた → あおい 1,500 円）。
  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement$`));
  await expect(page.getByText("対象 1 件")).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("1,500 円");
  await expect(page.getByText("カフェ")).toBeVisible();
});
