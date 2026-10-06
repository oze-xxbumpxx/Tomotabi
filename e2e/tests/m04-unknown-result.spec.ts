import { expect, test } from "../support/fixtures";
import { createTrip } from "../support/trips";

// M-04（docs/tests/m2-trips-and-plans.md、ADR-0005 Decision 3）:
// 予定の追加のPOSTをpage.routeでサーバーに通し（route.fetch()）、
// 応答だけ捨てる（route.abort("failed")）→ 結果不明（C-4）と入力の固定
// → unroute →「同じ内容で確認する」→ 成功 → その日の予定は1件だけ
// （同じ要求の再送で重複して作られない）。
// 日はすべて明示して選ぶ（しおりの既定の日は実行する日で変わる）。
const TRIP = {
  name: "松山 2 泊",
  startsOn: "2026-11-02", // 11/2 月
  endsOn: "2026-11-04", // 11/4 水
};
const PLAN_NAME = "道後温泉";

test("M-04: 応答の届かなかった保存は同じ内容で確認する", async ({
  hinataPage: page,
}) => {
  await createTrip(page, TRIP);

  // 2日目（11/3火）を日付バーで明示して選ぶ。
  await page
    .getByRole("navigation", { name: "日付を選ぶ" })
    .getByRole("link", { name: /^2 日目/ })
    .click();
  await page.waitForURL(/date=2026-11-03/);
  await expect(
    page.getByText("この日の予定はまだありません"),
  ).toBeVisible();

  // 追加のPOSTだけを捕まえ、APIに届けてから応答を捨てる
  // （サーバーでは保存が成立し、ブラウザにはnetwork失敗に見える）。
  await page.route("**/api/trips/*/plans", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fetch();
    await route.abort("failed");
  });

  await page.getByRole("link", { name: "予定を追加" }).click();
  const sheet = page.getByRole("dialog", { name: "予定を追加" });
  await sheet.getByLabel("名前").fill(PLAN_NAME);
  // 種類のradioはsr-only（見た目のspanがポインタを受ける）ため
  // forceで選ぶ。M-01のaddPlanと同じ。
  await sheet
    .getByRole("radio", { name: "場所" })
    .check({ force: true });
  // 日付もフォームで明示する（既定値に依存しない）。
  await sheet
    .getByRole("radio", { name: "11/3 火", exact: true })
    .click();
  await sheet.getByRole("button", { name: "保存", exact: true }).click();

  // C-4: 「保存されたか確認できません」と、入力欄の固定。
  await expect(
    sheet
      .getByRole("alert")
      .filter({ hasText: "保存されたか確認できません" }),
  ).toBeVisible();
  await expect(sheet.getByLabel("名前")).toHaveJSProperty(
    "readOnly",
    true,
  );

  // 経路を戻し、「同じ内容で確認する」で同じ要求だけを送り直す。
  await page.unroute("**/api/trips/*/plans");
  await sheet
    .getByRole("button", { name: "同じ内容で確認する" })
    .click();
  await page.waitForURL(/\/itinerary\?date=2026-11-03/);
  await expect(
    page.getByRole("status").filter({ hasText: "追加しました" }),
  ).toBeVisible();

  // その日のしおりの予定は1件だけ（サーバーで作られた分が再送で
  // 重複しない）。
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(
    page.getByRole("listitem").filter({ hasText: PLAN_NAME }),
  ).toBeVisible();
});
