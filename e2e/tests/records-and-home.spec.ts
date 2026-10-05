// docs/tests/records-and-home.md の RE-01〜RE-04 を実APIつなぎで検証する。
// 記録（達成・支払いの取り消し）・ホームの4画面・受け渡しの確認の了承・
// 予定の編集の送り直しを、実物のデータだけを通す。

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { createTrip } from "../support/trips";

type PlanInput = {
  name: string;
  /** 種類の選択肢の読み上げ名（`場所`・`食べ処`など）。 */
  kindLabel: string;
  /** 期間内の日付の表示（`11/7 土`の形）。 */
  dateLabel: string;
};

type PaymentInput = {
  /** 金額（円）を半角数字で入れる。入力欄は桁区切りを受け付けない。 */
  amount: string;
  /** 用途。空欄の支払いは名前が「支払い」になる。 */
  label?: string;
  /** 払った人として選ぶ相手の選択肢名。省略時はログイン中の本人のまま。 */
  payerName?: string;
};

/** しおりから予定を1件足す（M-01のaddPlanと同じ作り方）。 */
async function addPlan(page: Page, plan: PlanInput): Promise<void> {
  await page.getByRole("link", { name: "予定を追加" }).click();
  const sheet = page.getByRole("dialog", { name: "予定を追加" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("名前").fill(plan.name);
  // 種類のradioはsr-only（見た目のspanがポインタを受ける）ためforceで選ぶ。
  await sheet
    .getByRole("radio", { name: plan.kindLabel, exact: true })
    .check({ force: true });
  await sheet
    .getByRole("radio", { name: plan.dateLabel, exact: true })
    .click();
  await sheet.getByRole("button", { name: "保存する" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "追加しました" }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: plan.name }),
  ).toBeVisible();
}

/**
 * 「支払いを記録」を開き、入力して保存し、しおりへ戻るところまで進める
 * （payment-and-settlement.spec.tsのrecordPaymentと同じ作り方）。
 */
async function recordPayment(page: Page, input: PaymentInput): Promise<void> {
  await page.getByRole("link", { name: "支払いを記録" }).click();
  const sheet = page.getByRole("dialog", { name: "支払いを記録" });
  await expect(sheet.getByLabel("金額")).toBeVisible();
  await expect(sheet.getByRole("radio", { name: /（自分）/ })).toBeChecked();
  if (input.payerName !== undefined) {
    // Segmented の radio は sr-only なので force で選ぶ。
    await sheet
      .getByRole("radio", { name: input.payerName, exact: true })
      .check({ force: true });
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

/** 下のタブバーからタブを開く。 */
async function openTab(
  page: Page,
  label: "ホーム" | "しおり" | "記録" | "精算",
): Promise<void> {
  await page
    .getByRole("navigation", { name: "タブ" })
    .getByRole("link", { name: label, exact: true })
    .click();
}

/** 記録の一覧で、名前がちょうど`name`の行（.rrow-nameの全文一致）。 */
function recordRow(page: Page, name: string): Locator {
  return page
    .locator(".rrow")
    .filter({
      has: page
        .locator(".rrow-name")
        .filter({ hasText: new RegExp(`^${name}$`) }),
    });
}

// どの試験も開始日より前に実行されるよう、旅行の期間は未来に置く
// （ホームの表示の種類を「出発前」に固定する。11/7は土曜）。
const TRIP = {
  name: "広島 2 泊",
  startsOn: "2026-11-07", // 11/7 土
  endsOn: "2026-11-09", // 11/9 月
};
const DAY_ONE_LABEL = "11/7 土";

test("RE-01: ホームから達成を付け、記録で取り消して付け直す", async ({
  hinataPage: page,
}) => {
  await createTrip(page, TRIP);
  await addPlan(page, {
    name: "厳島神社",
    kindLabel: "場所",
    dateLabel: DAY_ONE_LABEL,
  });

  // ホームを開く → 出発前なので初日の予定の欄にその予定が出る。
  await openTab(page, "ホーム");
  await expect(
    page.getByRole("heading", { name: TRIP.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "初日の予定" }),
  ).toBeVisible();

  // 予定の行 → 予定の詳細（ホームから来た印つき）→ 達成を記録。
  await page
    .locator(".plan-item")
    .filter({ hasText: "厳島神社" })
    .click();
  await page.waitForURL(/\/trips\/[^/]+\/plans\/[^/?]+\?from=home$/);
  await expect(
    page.getByRole("heading", { name: "厳島神社" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "達成を記録" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "達成を記録しました" }),
  ).toBeVisible();
  // 達成が付くと主ボタンは「支払いを記録」に戻る（もう付けられない）。
  await expect(page.locator(".main-action")).toContainText("支払いを記録");

  // 記録の一覧 → 達成の行を押す → 小さな詳細 → 取り消す → 確認。
  await openTab(page, "記録");
  await expect(page.getByRole("heading", { name: "記録" })).toBeVisible();
  const achieveRow = recordRow(page, "厳島神社");
  await expect(achieveRow).toBeVisible();
  await expect(achieveRow.locator(".rrow-meta")).toContainText("達成");
  await achieveRow.click();
  const eventSheet = page.getByRole("dialog", { name: "記録" });
  await expect(eventSheet).toBeVisible();
  await expect(
    eventSheet.getByText("達成", { exact: true }).first(),
  ).toBeVisible();
  await eventSheet.getByRole("button", { name: "取り消す" }).click();
  const cancelDialog = page.getByRole("dialog", {
    name: "この記録を取り消しますか？",
  });
  await expect(cancelDialog).toBeVisible();
  await expect(cancelDialog.getByText(/厳島神社/)).toBeVisible();
  await cancelDialog.getByRole("button", { name: "取り消す" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "取り消しました" }),
  ).toBeVisible();

  // 元の行は「取り消し済み」、新しい順で取り消しの行が足される。
  const cancelledRow = recordRow(page, "厳島神社");
  await expect(cancelledRow.locator(".rrow-pill")).toHaveText("取り消し済み");
  await expect(recordRow(page, "厳島神社を取り消し")).toBeVisible();

  // 取り消した行から予定を開いて、同じ達成をもう一度付けられる。
  await cancelledRow.click();
  const eventSheetAgain = page.getByRole("dialog", { name: "記録" });
  await expect(eventSheetAgain).toBeVisible();
  // 取り消し済みの記録には「取り消す」は出ない。
  await expect(
    eventSheetAgain.getByRole("button", { name: "取り消す" }),
  ).toHaveCount(0);
  await eventSheetAgain.getByRole("link", { name: "予定を開く" }).click();
  await page.waitForURL(/\/trips\/[^/]+\/plans\/[^/?]+$/);
  await page.getByRole("button", { name: "達成を記録" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "達成を記録しました" }),
  ).toBeVisible();
  await expect(page.locator(".main-action")).toContainText("支払いを記録");
  await expect(
    page.locator(".plan-record-label").filter({ hasText: "達成" }),
  ).toBeVisible();

  // 記録の一覧には有効な達成・取り消し済みの達成・取り消しの3行が並ぶ。
  await openTab(page, "記録");
  await expect(recordRow(page, "厳島神社")).toHaveCount(2);
  await expect(recordRow(page, "厳島神社を取り消し")).toHaveCount(1);
});

test("RE-02: 終了すると予定の欄が消えて精算が上に出る。終了後も支払いと精算ができる", async ({
  hinataPage: page,
}) => {
  const tripId = await createTrip(page, {
    name: "尾道 2 泊",
    startsOn: "2026-11-07",
    endsOn: "2026-11-09",
  });

  // 精算の欄に受け渡しが出るよう、先に支払いを入れておく。
  // ひなた 7,000円・あおい 3,000円（ともに折半）→ あおい→ひなた 2,000円。
  await recordPayment(page, { amount: "7000", label: "レンタカー" });
  await recordPayment(page, {
    amount: "3000",
    label: "ランチ",
    payerName: "あおい",
  });
  await addPlan(page, {
    name: "千光寺",
    kindLabel: "場所",
    dateLabel: DAY_ONE_LABEL,
  });

  // 出発前のホーム: 予定の欄が精算の欄より上にある。
  await openTab(page, "ホーム");
  await expect(
    page.getByRole("heading", { name: "初日の予定" }),
  ).toBeVisible();
  await expect(
    page.locator(".home-page > section").first(),
  ).not.toHaveClass(/home-settle/);

  // 開始 → 終了（予定の欄が出る期間中を飛ばして終了後の形にする）。
  await page.getByRole("button", { name: "旅行のメニュー" }).click();
  await page
    .getByRole("dialog", { name: "尾道 2 泊" })
    .getByRole("button", { name: "旅行を開始する" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "旅行を開始しました" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "旅行のメニュー" }).click();
  await page
    .getByRole("dialog", { name: "尾道 2 泊" })
    .getByRole("button", { name: "旅行を終了する" })
    .click();
  await page
    .getByRole("dialog", { name: "旅行を終了しますか？" })
    .getByRole("button", { name: "終了する" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "旅行を終了しました" }),
  ).toBeVisible();

  // 終了後のホーム: 予定の欄は消え、精算の欄が一番上に出る。
  await expect(
    page.getByRole("heading", { name: "初日の予定" }),
  ).toHaveCount(0);
  await expect(page.locator(".home-page > section").first()).toHaveClass(
    /home-settle/,
  );
  await expect(page.locator(".home-settle")).toContainText(
    "あおい から ひなた へ",
  );
  await expect(
    page.locator(".home-settle .home-settle-amount"),
  ).toContainText("2,000");

  // 終了したあとも支払いを記録できる（あおい 2,000円 → あおい→ひなた 1,000円）。
  await recordPayment(page, {
    amount: "2000",
    label: "カフェ",
    payerName: "あおい",
  });

  // 精算（受け渡しの確認と記録）もできる。
  await openTab(page, "精算");
  await expect(page.getByRole("heading", { name: "精算" })).toBeVisible();
  await expect(page.getByText("対象 3 件")).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("1,000 円");
  await page.getByRole("button", { name: "受け渡しを確認する" }).click();
  await page.waitForURL(
    new RegExp(`/trips/${tripId}/settlement/previews/[^/]+$`),
  );
  await expect(
    page.getByRole("heading", { name: "受け渡しの確認" }),
  ).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("1,000 円");
  await page
    .getByRole("checkbox", { name: "表示の全額を受け渡しました" })
    .check();
  await page.getByRole("button", { name: "受け渡し完了を記録" }).click();
  await page
    .getByRole("dialog", { name: "受け渡し完了を記録しますか？" })
    .getByRole("button", { name: "記録する" })
    .click();
  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement$`));
  await expect(
    page.getByRole("status").filter({ hasText: "今回の精算を記録しました" }),
  ).toBeVisible();
  await expect(
    page.getByText("現在、精算する対象はありません"),
  ).toBeVisible();
});

test("RE-03: 確認を作ったあと支払いを取り消し、了承して記録する", async ({
  hinataPage: page,
}) => {
  const tripId = await createTrip(page, {
    name: "倉敷 1 泊",
    startsOn: "2026-11-07",
    endsOn: "2026-11-08",
  });

  // ひなた 2,000円（折半）→ あおい → ひなた 1,000円 の確認を作る。
  await recordPayment(page, { amount: "2000", label: "美観地区カフェ" });
  await openTab(page, "精算");
  await expect(page.getByRole("heading", { name: "精算" })).toBeVisible();
  await page.getByRole("button", { name: "受け渡しを確認する" }).click();
  await page.waitForURL(
    new RegExp(`/trips/${tripId}/settlement/previews/[^/]+$`),
  );
  await expect(
    page.getByRole("heading", { name: "受け渡しの確認" }),
  ).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("1,000 円");
  const previewUrl = page.url();

  // 対象の支払いを、記録の一覧 → 支払いの詳細から取り消す。
  // （受け渡しの確認の画面にはタブバーが無いためURLで記録へ戻る）
  await page.goto(`/trips/${tripId}/records`);
  await expect(page.getByRole("heading", { name: "記録" })).toBeVisible();
  await recordRow(page, "美観地区カフェ").click();
  await page.waitForURL(/\/trips\/[^/]+\/payments\/[^/?]+$/);
  await page.getByRole("button", { name: "取り消す" }).click();
  await page
    .getByRole("dialog", { name: "この記録を取り消しますか？" })
    .getByRole("button", { name: "取り消す" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "取り消しました" }),
  ).toBeVisible();
  await expect(page.getByText("取り消し済み").first()).toBeVisible();

  // 確認を開き直す → 取り消された明細の了承の画面に変わる。
  await page.goto(previewUrl);
  const ackCard = page.locator(".settle-card").filter({
    hasText: "対象の支払いが取り消されました",
  });
  await expect(ackCard).toBeVisible();
  await expect(ackCard.locator(".settle-item-name")).toHaveText(
    "美観地区カフェ",
  );
  await expect(ackCard).toContainText("取り消しました");
  await expect(
    ackCard.getByRole("link", { name: "最新の残額で確認を作り直す" }),
  ).toBeVisible();

  // 全額受け渡し済みの道: 明細のチェックを付けるまで記録できない。
  const ackButton = page.getByRole("button", {
    name: "了承して受け渡し完了を記録",
  });
  await expect(ackButton).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "美観地区カフェの取り消しを確かめました",
    })
    .check();
  await expect(ackButton).toBeEnabled();
  await ackButton.click();
  await page
    .getByRole("dialog", { name: "受け渡し完了を記録しますか？" })
    .getByRole("button", { name: "記録する" })
    .click();

  // 了承つきで精算が記録され、履歴に「あおい → ひなた」の受け渡しが残る。
  await page.waitForURL(new RegExp(`/trips/${tripId}/settlement$`));
  await expect(
    page.getByRole("status").filter({ hasText: "今回の精算を記録しました" }),
  ).toBeVisible();
  await expect(
    page.getByText(/あおい から ひなた へ 1,000 円/),
  ).toBeVisible();
  // 取り消した支払いの戻しは次回の調整として対象に残る（F-25）。
  // 方向は「ひなた → あおい」（名前は別のspanに分かれるため要素で見る）。
  await expect(page.getByText("対象 1 件")).toBeVisible();
  await expect(page.locator(".settle-amount")).toHaveText("1,000 円");
  await expect(
    page.locator(".settle-transfer .settle-person-name").first(),
  ).toHaveText("ひなた");
  await expect(
    page.locator(".settle-transfer .settle-person-name").nth(1),
  ).toHaveText("あおい");
  await expect(page.getByText(/取り消し済みの戻し/)).toBeVisible();
});

test("RE-04: 予定の編集で応答が届かなければ、再読み込みのあと同じ内容で送り直す", async ({
  hinataPage: page,
}) => {
  await createTrip(page, {
    name: "福山 1 泊",
    startsOn: "2026-11-07",
    endsOn: "2026-11-08",
  });
  await addPlan(page, {
    name: "福山城",
    kindLabel: "場所",
    dateLabel: DAY_ONE_LABEL,
  });

  // 予定の詳細 → 編集のシート。
  await page.getByRole("link", { name: /福山城/ }).click();
  // しおりの予定リンクは`?from=<日付>`付きで詳細を開く。
  await page.waitForURL(/\/trips\/[^/]+\/plans\/[^/?]+\?.*$/);
  await expect(
    page.getByRole("heading", { name: "福山城" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "編集" }).click();
  const sheet = page.getByRole("dialog", { name: "予定を編集" });
  await expect(sheet).toBeVisible();

  // 編集のPATCHだけを捕まえ、APIに届けてから応答を捨てる
  // （M-04・FE-04と同じ作り方。サーバーでは保存が成立し、
  // ブラウザにはnetwork失敗に見える）。
  await page.route("**/api/trips/*/plans/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fetch();
    await route.abort("failed");
  });
  await sheet.getByLabel("名前").fill("福山城（天守）");
  await sheet.getByRole("button", { name: "保存する" }).click();

  // 「保存されたか確認できません」と入力の固定。
  await expect(
    sheet
      .getByRole("alert")
      .filter({ hasText: "保存されたか確認できません" }),
  ).toBeVisible();
  await expect(sheet.getByLabel("名前")).toHaveJSProperty("readOnly", true);

  // 再読み込み → 端末に残した要求が見つかり、シートは固定されたまま
  // 「保存されたか確認できません」に戻る（同じ要求だけを送り直せる）。
  await page.unroute("**/api/trips/*/plans/*");
  await page.reload();
  const sheetAgain = page.getByRole("dialog", { name: "予定を編集" });
  await expect(
    sheetAgain
      .getByRole("alert")
      .filter({ hasText: "保存されたか確認できません" }),
  ).toBeVisible();
  await expect(sheetAgain.getByLabel("名前")).toHaveJSProperty(
    "readOnly",
    true,
  );
  await sheetAgain
    .getByRole("button", { name: "同じ内容で確認する" })
    .click();

  // 予定の詳細に戻り、送り直した内容が1回だけ反映されている。
  await page.waitForURL(/\/trips\/[^/]+\/plans\/[^/?]+$/);
  await expect(
    page.getByRole("status").filter({ hasText: "変更しました" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "福山城（天守）" }),
  ).toBeVisible();
});
