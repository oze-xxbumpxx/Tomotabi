import type { Page } from "@playwright/test";
import { daysFromToday, formatDayLabel } from "../support/dates";
import { expect, test } from "../support/fixtures";

// M-01（docs/tests/m2-trips-and-plans.md）: ひなたで旅行を作る → しおりで
// 予定を3件（時刻なしを含む）→ 編集・移動・取りやめ → 開始 → 終了 →
// 終了後に予定を追加。すべて画面どおりに反映されることを確かめる。
// 期間は実行日から数える（出発前のまま確かめる。e2e/support/dates.ts）。
const DAY_1 = daysFromToday(30);
const DAY_2 = daysFromToday(31);
const DAY_3 = daysFromToday(32);
const TRIP = {
  name: "京都 2 泊",
  startsOn: DAY_1,
  endsOn: DAY_3,
};

async function addPlan(
  page: Page,
  plan: {
    name: string;
    /** 種類の選択肢の読み上げ名（`場所`・`食べ処`など）。 */
    kindLabel: string;
    /** 期間内の日付の表示（`10/11 日`の形）。省略時はフォームの初期値の日。 */
    dateLabel?: string;
    /** `HH:MM`。nullは「時刻未定」のままにする。 */
    time?: string;
  },
): Promise<void> {
  await page.getByRole("link", { name: "予定を追加" }).click();
  await expect(
    page.getByRole("heading", { name: "予定を追加" }),
  ).toBeVisible();
  await page.getByLabel("名前").fill(plan.name);
  // 種類のradioはsr-onlyで読み上げ名だけを持ち、見た目の
  // 選択肢（label内のspan）がポインタを受けるためforceで選ぶ。
  await page
    .getByRole("radio", { name: plan.kindLabel, exact: true })
    .check({ force: true });
  if (plan.dateLabel !== undefined) {
    await page
      .getByRole("radio", { name: plan.dateLabel, exact: true })
      .click();
  }
  if (plan.time !== undefined) {
    await page
      .getByRole("checkbox", { name: "時刻未定" })
      .uncheck();
    await page.getByLabel("時刻", { exact: true }).fill(plan.time);
  }
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "追加しました" })).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: plan.name }),
  ).toBeVisible();
}

test("M-01: 旅行の作成から終了後の予定の追加まで", async ({
  hinataPage: page,
}) => {
  await page.goto("/trips");
  await expect(page.getByText("旅行はまだありません")).toBeVisible();

  // 旅行を作る → しおりへ移る
  await page.getByRole("link", { name: "新しい旅行をつくる" }).click();
  const newTripSheet = page.getByRole("dialog", { name: "新しい旅行" });
  await newTripSheet.getByLabel("旅行名").fill(TRIP.name);
  await newTripSheet.getByLabel("開始日").fill(TRIP.startsOn);
  await newTripSheet.getByLabel("終了日").fill(TRIP.endsOn);
  await newTripSheet
    .getByRole("button", { name: "旅行をつくる" })
    .click();
  await page.waitForURL(/\/trips\/[^/]+\/itinerary/);
  await expect(
    page.getByRole("heading", { name: TRIP.name }),
  ).toBeVisible();
  await expect(page.getByText("出発前", { exact: true })).toBeVisible();

  // しおりの初期表示は「期間内なら今日・期間外なら初日」。実行日に
  // 依存しないよう、日付バーで初日を明示して選んでから進める。
  // 以後の日の切り替えもすべて日付バーか詳細の日付リンクで行う。
  await page
    .getByRole("navigation", { name: "日付を選ぶ" })
    .getByRole("link", { name: /^1 日目/ })
    .click();
  await page.waitForURL(new RegExp(`date=${DAY_1}`));
  await expect(
    page.getByText("この日の予定はまだありません"),
  ).toBeVisible();

  // 1日目に予定を3件。時刻順に並び、時刻未定は末尾。
  await addPlan(page, {
    name: "清水寺",
    kindLabel: "場所",
    time: "09:00",
  });
  await addPlan(page, {
    name: "錦市場",
    kindLabel: "買い物",
    time: "12:30",
  });
  await addPlan(page, {
    name: "先斗町で夕食",
    kindLabel: "食べ処",
  });
  const dayOneItems = page.getByRole("listitem");
  await expect(dayOneItems).toHaveCount(3);
  await expect(dayOneItems.nth(0)).toContainText("09:00");
  await expect(dayOneItems.nth(0)).toContainText("清水寺");
  await expect(dayOneItems.nth(1)).toContainText("12:30");
  await expect(dayOneItems.nth(1)).toContainText("錦市場");
  await expect(dayOneItems.nth(2)).toContainText("未定");
  await expect(dayOneItems.nth(2)).toContainText("先斗町で夕食");

  // 編集: 清水寺の名前を変える
  await page.getByRole("link", { name: /清水寺/ }).click();
  await expect(
    page.getByRole("heading", { name: "清水寺" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "編集" }).click();
  await expect(
    page.getByRole("heading", { name: "予定を編集" }),
  ).toBeVisible();
  await page.getByLabel("名前").fill("清水寺（早朝参り）");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "変更しました" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "清水寺（早朝参り）" }),
  ).toBeVisible();

  // 日の移動: 1日目 → 2日目
  await page.getByRole("button", { name: "日の移動" }).click();
  const moveSheet = page.getByRole("dialog", { name: "日の移動" });
  await moveSheet
    .getByRole("radio", { name: formatDayLabel(DAY_2), exact: true })
    .click();
  await moveSheet
    .getByRole("button", { name: "この日に移動する" })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "移動しました" })).toBeVisible();

  // 詳細の日付リンク（`?date=plan.date`行き）から2日目のしおりへ
  const planDateLink = page.getByRole("link", {
    name: formatDayLabel(DAY_2),
    exact: true,
  });
  await expect(planDateLink).toBeVisible();
  await planDateLink.click();
  await page.waitForURL(new RegExp(`date=${DAY_2}`));
  await expect(
    page.getByRole("listitem").filter({ hasText: "清水寺（早朝参り）" }),
  ).toBeVisible();

  // 1日目のしおりには出ない
  await page
    .getByRole("navigation", { name: "日付を選ぶ" })
    .getByRole("link", { name: /^1 日目/ })
    .click();
  await page.waitForURL(new RegExp(`date=${DAY_1}`));
  await expect(
    page.getByRole("listitem").filter({ hasText: "清水寺" }),
  ).toHaveCount(0);

  // 取りやめ（予定は2日目にある。日付バーで明示して選ぶ）
  await page
    .getByRole("navigation", { name: "日付を選ぶ" })
    .getByRole("link", { name: /2 日目/ })
    .click();
  await page.waitForURL(new RegExp(`date=${DAY_2}`));
  await page.getByRole("link", { name: /清水寺（早朝参り）/ }).click();
  await page.getByRole("button", { name: "取りやめにする" }).click();
  const cancelDialog = page.getByRole("dialog", {
    name: "予定を取りやめにしますか？",
  });
  await cancelDialog
    .getByRole("button", { name: "取りやめにする" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "取りやめにしました" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取りやめにする" }),
  ).not.toBeVisible();
  // 詳細の日付リンクで2日目のしおりへ戻る（取りやめでも日付は変わらない）
  await page
    .getByRole("link", { name: formatDayLabel(DAY_2), exact: true })
    .click();
  await page.waitForURL(new RegExp(`date=${DAY_2}`));
  await expect(
    page.getByRole("listitem").filter({ hasText: "清水寺（早朝参り）" }),
  ).toContainText("取りやめ");

  // 開始 → 「旅行中」のバッジ
  await page.getByRole("button", { name: "旅行のメニュー" }).click();
  const menu = page.getByRole("dialog", { name: TRIP.name });
  await menu.getByRole("button", { name: "旅行を開始する" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "旅行を開始しました" }),
  ).toBeVisible();
  await expect(page.getByText("旅行中", { exact: true })).toBeVisible();

  // 終了 → 「終了」のバッジ
  await page.getByRole("button", { name: "旅行のメニュー" }).click();
  await page
    .getByRole("dialog", { name: TRIP.name })
    .getByRole("button", { name: "旅行を終了する" })
    .click();
  const finishDialog = page.getByRole("dialog", {
    name: "旅行を終了しますか？",
  });
  await finishDialog.getByRole("button", { name: "終了する" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "旅行を終了しました" }),
  ).toBeVisible();
  await expect(page.getByText("終了", { exact: true })).toBeVisible();

  // 終了後も予定を追加できる（3日目に時刻未定で追加）
  await page
    .getByRole("navigation", { name: "日付を選ぶ" })
    .getByRole("link", { name: /3 日目/ })
    .click();
  await page.waitForURL(new RegExp(`date=${DAY_3}`));
  await addPlan(page, { name: "駅でお土産", kindLabel: "買い物" });
  await expect(
    page.getByRole("listitem").filter({ hasText: "駅でお土産" }),
  ).toContainText("未定");
});
