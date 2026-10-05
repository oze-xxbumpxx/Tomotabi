import { addSessionCookies } from "../support/auth";
import { HINATA_USER_ID } from "../support/env";
import { expect, test } from "../support/fixtures";
import { createTrip } from "../support/trips";

// M-03（docs/tests/m2-trips-and-plans.md）: ひなたで旅行を2つ作り、
// 2つ目のしおりを開く → メニューからログアウト → 新しいセッションの
// Cookieを入れ直して`/`を開く → 旅行一覧（ログアウトで保存値が
// 消えている）。一覧で1つ目を選んでしおりを開く → `/`を開き直す →
// 1つ目のホームに戻る（前回の旅行はホームを開く）。
const FIRST_TRIP = {
  name: "高松 2 泊",
  startsOn: "2026-10-15",
  endsOn: "2026-10-17",
};
const SECOND_TRIP = {
  name: "直島日帰り",
  startsOn: "2026-11-20",
  endsOn: "2026-11-20",
};

test("M-03: ログアウトのあと、前回開いた旅行に戻る", async ({
  hinataPage: page,
}) => {
  const firstTripId = await createTrip(page, FIRST_TRIP);
  await createTrip(page, SECOND_TRIP);

  // 2つ目のしおりを開いたまま、メニューからログアウトする。
  await page.getByRole("button", { name: "旅行のメニュー" }).click();
  await page
    .getByRole("dialog", { name: SECOND_TRIP.name })
    .getByRole("button", { name: "ログアウト" })
    .click();
  await page.waitForURL(/\/sign-in/);

  // 新しいセッションのCookieを入れ直して`/`を開く。同じcontextの
  // localStorageを使うので、ログアウトで保存値が消えていなければ
  // 2つ目のしおりに飛んでしまう。
  await addSessionCookies(page, HINATA_USER_ID);
  await page.goto("/");
  await page.waitForURL(/\/trips$/);
  await expect(
    page.getByRole("heading", { name: "旅行を切り替え" }),
  ).toBeVisible();

  // 一覧で1つ目を選ぶ → 1つ目のしおり。
  // 行の読み上げ名は旅行名に期間・状態が付くため、名前で前方一致させる。
  await page
    .getByRole("link", { name: new RegExp(`^${FIRST_TRIP.name}`) })
    .click();
  await page.waitForURL(`/trips/${firstTripId}/itinerary`);
  await expect(
    page.getByRole("heading", { name: FIRST_TRIP.name }),
  ).toBeVisible();

  // `/`を開き直す → 今度は1つ目のホームに戻る（前回の旅行はホームを開く）。
  await page.goto("/");
  await page.waitForURL(`/trips/${firstTripId}/home`);
  await expect(
    page.getByRole("heading", { name: FIRST_TRIP.name }),
  ).toBeVisible();
});
