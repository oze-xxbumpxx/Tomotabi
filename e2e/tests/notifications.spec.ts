// docs/tests/push-notifications.md の PE-01〜PE-04 を実APIつなぎで検証する。
// 実機・実push配信は確かめない（PM-03は最後の受け入れに回す）。ブラウザの
// 通知許可はgrantPermissionsで許可済み、PushManager.subscribeは
// ページ側に入れる見せかけ（support/push.ts）で賄う。VAPIDの鍵は実行ごとに
// run.mjsが作ってAPIに渡すため、購読の登録・停止は実APIを通る。

import type { Page } from "@playwright/test";

import { addSessionCookies } from "../support/auth";
import { daysFromToday, formatDayLabel } from "../support/dates";
import { HINATA_USER_ID } from "../support/env";
import { expect, test } from "../support/fixtures";
import { preparePushStub } from "../support/push";
import { createTrip } from "../support/trips";

// いつ走らせてもホームの表示の種類が「出発前」になるよう、旅行の期間は
// 実行日の日本時間の今日から数えて作る。
const TRIP = {
  name: "香川 1 泊",
  startsOn: daysFromToday(30),
  endsOn: daysFromToday(31),
};
const DAY_ONE_LABEL = formatDayLabel(TRIP.startsOn);

/** しおりの画面から予定を1件足す（records-and-home.spec.tsのaddPlanと同じ作り方）。 */
async function addPlan(page: Page, name: string): Promise<void> {
  await page.getByRole("link", { name: "予定を追加" }).click();
  const sheet = page.getByRole("dialog", { name: "予定を追加" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("名前").fill(name);
  // 種類のradioはsr-only（見た目のspanがポインタを受ける）ためforceで選ぶ。
  await sheet
    .getByRole("radio", { name: "場所", exact: true })
    .check({ force: true });
  await sheet
    .getByRole("radio", { name: DAY_ONE_LABEL, exact: true })
    .click();
  await sheet.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "追加しました" }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: name }),
  ).toBeVisible();
}

/** しおりの画面から支払いを1件記録する（ひなたが払った・折半）。 */
async function recordPayment(page: Page, label: string): Promise<void> {
  await page.getByRole("link", { name: "支払いを記録" }).click();
  const sheet = page.getByRole("dialog", { name: "支払いを記録" });
  await expect(sheet.getByLabel("金額")).toBeVisible();
  await expect(
    sheet.getByRole("radio", { name: /（自分）/ }),
  ).toBeChecked();
  await sheet.getByLabel("金額").fill("3000");
  await sheet.getByLabel("用途").fill(label);
  await sheet.getByRole("button", { name: "保存" }).click();
  await page.waitForURL(/\/trips\/[^/]+\/itinerary$/);
  await expect(
    page.getByRole("status").filter({ hasText: "支払いを記録しました" }),
  ).toBeVisible();
}

/** 「旅行のメニュー」から「この端末の通知」の設定画面を開く。 */
async function openNotificationSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "旅行のメニュー" }).click();
  await page
    .getByRole("dialog", { name: TRIP.name })
    .getByRole("link", { name: "この端末の通知" })
    .click();
  await page.waitForURL(/\/settings\/notifications\?from=/);
  await expect(
    page.getByRole("heading", { name: "この端末の通知" }),
  ).toBeVisible();
}

test("PE-01: 旅行のメニューから設定を開き、この端末の通知を有効→停止する", async ({
  hinataPage: page,
}) => {
  await preparePushStub(page);
  await createTrip(page, TRIP);
  await openNotificationSettings(page);

  // 有効にする → 「この端末」が有効になり、端末の一覧に載る。
  await page
    .getByRole("button", { name: "通知を有効にする" })
    .click();
  await expect(page.getByText("有効", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "この端末" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /通知を受け取る端末（1 \/ 3台）/ }),
  ).toBeVisible();

  // この端末の通知を止める → 一覧が空になる。
  await page
    .getByRole("button", { name: "この端末の通知を止める" })
    .click();
  await expect(
    page.getByText("登録されている端末はありません"),
  ).toBeVisible();
});

test("PE-02: ホームの通知カードを閉じると、開き直しても出ない", async ({
  hinataPage: page,
}) => {
  await preparePushStub(page);
  const tripId = await createTrip(page, TRIP);
  await page.goto(`/trips/${tripId}/home`);
  await expect(
    page.getByRole("heading", { name: TRIP.name }),
  ).toBeVisible();

  // 未登録・許可はdefaultでは閉じる前のカードが出る。
  const card = page.getByRole("region", { name: "通知の案内" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "閉じる" }).click();
  await expect(card).toHaveCount(0);

  // 閉じた印（tomotabi:push-guide-dismissed:<利用者のID>）が
  // この人のlocalStorageに入る。
  await expect
    .poll(() =>
      page.evaluate(
        `localStorage.getItem(${JSON.stringify(`tomotabi:push-guide-dismissed:${HINATA_USER_ID}`)})`,
      ),
    )
    .toBe("1");

  // 開き直しても出ない。カードは描画の最初はdismissed=trueで出ず、
  // localStorageとAPI（設定・一覧）の読み込みが終わってから出すか
  // 決まる。読み込みが終わるまで待ってから、出ないことを確かめる
  // （終わる前に見ると、カードがあとから出る壊れ方を見逃す）。
  const configResponse = page.waitForResponse((response) =>
    response.url().includes("/api/me/push-config"),
  );
  const subscriptionsResponse = page.waitForResponse((response) =>
    response.url().includes("/api/me/push-subscriptions"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: TRIP.name }),
  ).toBeVisible();
  await Promise.all([configResponse, subscriptionsResponse]);
  // 応答が返ってからカードの表示の判定まで少し待つ。
  await page.waitForTimeout(500);
  await expect(card).toHaveCount(0);
});

test("PE-03: 通知から開くパス（記録の1件・予定の詳細・精算）を直接開くと対象が出る", async ({
  hinataPage: page,
}) => {
  const tripId = await createTrip(page, TRIP);

  // 対象の材料: 予定1件、支払い1件、精算1件。
  await addPlan(page, "栗林公園");
  const planHref = await page
    .getByRole("link", { name: /栗林公園/ })
    .getAttribute("href");
  const planPath = planHref?.split("?")[0];
  if (planPath === undefined) {
    throw new Error("予定の詳細へのリンクが見つかりません");
  }
  await recordPayment(page, "うどん");

  // 支払いの記録IDは一覧APIから取る（画面のリンクは支払いの詳細に
  // 行くため、絞り込みの元記録IDを直接は取れない）。
  const recordsResponse = await page.request.get(
    `/api/trips/${tripId}/records?type=payment`,
  );
  const recordsBody = (await recordsResponse.json()) as {
    items: { id: string }[];
  };
  const paymentRecordId = recordsBody.items[0]?.id;
  if (paymentRecordId === undefined) {
    throw new Error("支払いの記録が一覧にありません");
  }

  // 精算を1件作る（受け渡しを確認 → 全額を受け渡した → 記録）。
  await page
    .getByRole("navigation", { name: "タブ" })
    .getByRole("link", { name: "精算", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "精算", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "受け渡しの内容を確かめる" }).click();
  await expect(
    page.getByRole("heading", { name: "受け渡しの確認" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "表示の全額を受け渡しました" })
    .check();
  await page.getByRole("button", { name: "受け渡し完了を記録" }).click();
  await page
    .getByRole("dialog", { name: "受け渡し完了を記録しますか？" })
    .getByRole("button", { name: "記録する" })
    .click();
  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement$`));
  const settlementsResponse = await page.request.get(
    `/api/trips/${tripId}/settlements`,
  );
  const settlementsBody = (await settlementsResponse.json()) as {
    items: { id: string }[];
  };
  const settlementId = settlementsBody.items[0]?.id;
  if (settlementId === undefined) {
    throw new Error("精算の記録が一覧にありません");
  }

  // 記録の一覧の1件（recordType=payment&recordId=）→ 絞り込み中とその行。
  await page.goto(
    `/trips/${tripId}/records?recordType=payment&recordId=${paymentRecordId}`,
  );
  await expect(page.getByText("この記録に絞り込み中")).toBeVisible();
  await expect(page.getByRole("link", { name: /うどん/ })).toBeVisible();

  // 予定の詳細 → 対象の予定が出る。
  await page.goto(planPath);
  await expect(
    page.getByRole("heading", { name: "栗林公園" }),
  ).toBeVisible();

  // 精算の1件（?settlementId=）→ 履歴で対象の行に印が付く。
  await page.goto(`/trips/${tripId}/settlement?settlementId=${settlementId}`);
  const focusedRow = page
    .getByRole("listitem")
    .filter({ hasText: "あおい から ひなた へ" });
  await expect(focusedRow).toBeVisible();
  await expect(focusedRow).toHaveAttribute("aria-current", "true");
});

test("PE-04: 有効のままログアウト→再ログインで、その端末の購読は無効になる", async ({
  hinataPage: page,
}) => {
  await preparePushStub(page);
  const tripId = await createTrip(page, TRIP);
  await openNotificationSettings(page);
  await page
    .getByRole("button", { name: "通知を有効にする" })
    .click();
  await expect(page.getByText("有効", { exact: true })).toBeVisible();

  // 有効のまま、ホームのメニューからログアウトする。
  await page.goto(`/trips/${tripId}/home`);
  await page.getByRole("button", { name: "旅行のメニュー" }).click();
  await page
    .getByRole("dialog", { name: TRIP.name })
    .getByRole("button", { name: "ログアウト" })
    .click();
  await page.waitForURL(/\/sign-in/);

  // 同じcontextで再ログイン → 設定を開くと「登録し直す」になる
  // （サーバーで止められている＝購読が無効の印。ログアウトで
  // ブラウザ側の購読も外れている）。
  await addSessionCookies(page, HINATA_USER_ID);
  await page.goto("/settings/notifications");
  await expect(
    page.getByRole("heading", { name: "この端末の通知" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "登録し直す" }),
  ).toBeVisible();
  await expect(
    page.getByText("この端末の通知はサーバーで止められています"),
  ).toBeVisible();
  await expect(
    page.getByText("登録されている端末はありません"),
  ).toBeVisible();
});
